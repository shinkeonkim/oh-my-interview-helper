import { expect, test } from "bun:test"

import { JobScheduler } from "../src/jobs/scheduler"
import { barrier, createHarness, flush, ManualClock } from "./scheduler-test-support"

test("cancels queued work idempotently and aborts a hanging running handler", async () => {
  // Given
  const clock = new ManualClock()
  const gate = barrier()
  let aborted = false
  const harness = createHarness([
    {
      kind: "local",
      retryClass: "local",
      maxAttempts: 2,
      run: async ({ signal }) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true
          },
          { once: true }
        )
        await gate.wait
      }
    }
  ])
  const queued = harness.runtime.enqueue({
    kind: "local",
    input: {},
    idempotencyKey: crypto.randomUUID()
  })

  // When
  harness.runtime.cancel(queued.id)
  harness.runtime.cancel(queued.id)
  const running = harness.runtime.enqueue({
    kind: "local",
    input: {},
    idempotencyKey: crypto.randomUUID()
  })
  const scheduler = new JobScheduler(harness.runtime, {
    clock,
    owner: "worker",
    idleMilliseconds: 10
  })
  scheduler.start()
  await flush()
  harness.runtime.cancel(running.id)
  await flush()

  // Then
  expect(harness.persistence.repositories.jobs.get({ id: queued.id })).toMatchObject({
    state: "cancelled"
  })
  expect(
    harness.persistence.repositories.jobs
      .events({ id: queued.id })
      .filter((event) => event.kind === "cancelled")
  ).toHaveLength(1)
  expect(aborted).toBe(true)
  expect(harness.persistence.repositories.jobs.get({ id: running.id })).toMatchObject({
    state: "cancelled"
  })
  expect(
    harness.persistence.repositories.jobs
      .events({ id: running.id })
      .filter((event) => ["succeeded", "failed", "cancelled"].includes(event.kind))
  ).toHaveLength(1)
  gate.release()
  await scheduler.stop()
  harness.close()
})

test("fails timed out handlers without retrying external work", async () => {
  // Given
  const clock = new ManualClock()
  const never = barrier()
  const harness = createHarness([
    { kind: "external", retryClass: "external", maxAttempts: 1, run: async () => never.wait }
  ])
  const timeout = harness.persistence.repositories.jobs.enqueue({
    id: crypto.randomUUID(),
    kind: "external",
    input: {},
    idempotencyKey: crypto.randomUUID(),
    retryClass: "external",
    maxAttempts: 1,
    now: clock.now().toISOString()
  }).job
  const scheduler = new JobScheduler(harness.runtime, {
    clock,
    owner: "worker",
    idleMilliseconds: 10,
    handlerTimeoutMilliseconds: 50
  })

  // When
  scheduler.start()
  await flush()
  clock.advance(50)
  await flush()

  // Then
  expect(harness.persistence.repositories.jobs.get({ id: timeout.id })).toMatchObject({
    state: "failed",
    errorCode: "handler_timeout"
  })
  never.release()
  await scheduler.stop()
  expect(clock.pending()).toBe(0)
  harness.close()
})

test("bounds shutdown by interrupting hung local work after its grace period", async () => {
  // Given
  const clock = new ManualClock()
  const never = barrier()
  let aborted = false
  const harness = createHarness([
    {
      kind: "local",
      retryClass: "local",
      maxAttempts: 2,
      run: async ({ signal }) => {
        signal.addEventListener("abort", () => {
          aborted = true
        })
        await never.wait
      }
    }
  ])
  const job = harness.persistence.repositories.jobs.enqueue({
    id: crypto.randomUUID(),
    kind: "local",
    input: {},
    idempotencyKey: crypto.randomUUID(),
    retryClass: "local",
    maxAttempts: 2,
    now: clock.now().toISOString()
  }).job
  const scheduler = new JobScheduler(harness.runtime, {
    clock,
    owner: "worker",
    idleMilliseconds: 10,
    handlerTimeoutMilliseconds: 1_000,
    shutdownGraceMilliseconds: 25
  })

  // When
  scheduler.start()
  await flush()
  const stopping = scheduler.stop()
  await flush()
  expect(aborted).toBe(false)
  expect(harness.persistence.repositories.jobs.get({ id: job.id })).toMatchObject({
    state: "running"
  })
  clock.advance(25)
  await stopping

  // Then
  expect(harness.persistence.repositories.jobs.get({ id: job.id })).toMatchObject({
    state: "queued",
    lastErrorCode: "interrupted",
    nextAttemptAt: "2026-08-26T12:00:01.025Z"
  })
  expect(aborted).toBe(true)
  expect(clock.pending()).toBe(0)
  never.release()
  harness.close()
})

test("recovers dead leases on startup while heartbeats keep live work unreclaimable", async () => {
  // Given
  const clock = new ManualClock()
  const gate = barrier()
  const harness = createHarness([
    { kind: "local", retryClass: "local", maxAttempts: 2, run: async () => gate.wait }
  ])
  const dead = harness.persistence.repositories.jobs.enqueue({
    id: crypto.randomUUID(),
    kind: "local",
    input: {},
    idempotencyKey: crypto.randomUUID(),
    retryClass: "local",
    maxAttempts: 2,
    now: clock.now().toISOString()
  }).job
  const live = harness.persistence.repositories.jobs.enqueue({
    id: crypto.randomUUID(),
    kind: "local",
    input: {},
    idempotencyKey: crypto.randomUUID(),
    retryClass: "local",
    maxAttempts: 2,
    now: clock.now().toISOString()
  }).job
  harness.persistence.repositories.jobs.claim({
    owner: "dead",
    now: clock.now().toISOString(),
    leaseMilliseconds: 1
  })
  const scheduler = new JobScheduler(harness.runtime, {
    clock,
    owner: "live",
    leaseMilliseconds: 20,
    heartbeatMilliseconds: 5,
    idleMilliseconds: 10
  })

  // When
  scheduler.start()
  await flush()
  clock.advance(25)
  const recovered = harness.persistence.repositories.jobs.recoverExpired({
    now: clock.now().toISOString()
  })

  // Then
  expect(recovered).toEqual([])
  expect(
    harness.persistence.repositories.jobs
      .events({ id: dead.id })
      .filter((event) => event.kind === "retry_scheduled")
  ).toHaveLength(1)
  expect(harness.persistence.repositories.jobs.get({ id: dead.id })).toMatchObject({
    state: "queued",
    attemptCount: 1,
    nextAttemptAt: "2026-08-26T12:00:01.010Z"
  })
  expect(harness.persistence.repositories.jobs.get({ id: live.id })).toMatchObject({
    state: "running",
    attemptCount: 1
  })
  gate.release()
  await scheduler.stop()
  harness.close()
})
