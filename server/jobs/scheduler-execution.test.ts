import { expect, test } from "bun:test"

import { JobScheduler } from "../src/jobs/scheduler"
import { barrier, createHarness, flush, ManualClock } from "./scheduler-test-support"

test("claims FIFO jobs exactly once across schedulers while honoring each concurrency bound", async () => {
  // Given
  const clock = new ManualClock()
  const gate = barrier()
  const started: string[] = []
  const harness = createHarness([
    {
      kind: "local",
      retryClass: "local",
      maxAttempts: 1,
      run: async ({ job }) => {
        const name = job.payload["name"]
        if (typeof name !== "string") throw new Error("Test job name is missing")
        started.push(name)
        await gate.wait
      }
    }
  ])
  for (const name of ["one", "two", "three", "four"])
    harness.persistence.repositories.jobs.enqueue({
      id: crypto.randomUUID(),
      kind: "local",
      input: { name },
      idempotencyKey: crypto.randomUUID(),
      retryClass: "local",
      maxAttempts: 1,
      now: clock.now().toISOString()
    })
  const first = new JobScheduler(harness.runtime, {
    clock,
    concurrency: 2,
    owner: "one",
    idleMilliseconds: 10
  })
  const second = new JobScheduler(harness.runtime, {
    clock,
    concurrency: 2,
    owner: "two",
    idleMilliseconds: 10
  })

  // When
  first.start()
  second.start()
  await flush()

  // Then
  expect(started).toEqual(["one", "two", "three", "four"])
  expect(harness.persistence.repositories.jobs.list().map((job) => job.attemptCount)).toEqual([
    1, 1, 1, 1
  ])
  gate.release()
  await flush()
  await Promise.all([first.stop(), second.stop()])
  harness.close()
})

test("retries local failures with deterministic backoff but never retries external failures", async () => {
  // Given
  const clock = new ManualClock()
  let localRuns = 0
  const harness = createHarness([
    {
      kind: "local",
      retryClass: "local",
      maxAttempts: 2,
      run: async () => {
        localRuns++
        if (localRuns === 1) throw new Error("transient")
      }
    },
    {
      kind: "external",
      retryClass: "external",
      maxAttempts: 2,
      run: async () => {
        throw new Error("billable")
      }
    }
  ])
  const local = harness.persistence.repositories.jobs.enqueue({
    id: crypto.randomUUID(),
    kind: "local",
    input: {},
    idempotencyKey: crypto.randomUUID(),
    retryClass: "local",
    maxAttempts: 2,
    now: clock.now().toISOString()
  }).job
  const external = harness.persistence.repositories.jobs.enqueue({
    id: crypto.randomUUID(),
    kind: "external",
    input: {},
    idempotencyKey: crypto.randomUUID(),
    retryClass: "external",
    maxAttempts: 2,
    now: clock.now().toISOString()
  }).job
  const scheduler = new JobScheduler(harness.runtime, {
    clock,
    concurrency: 1,
    owner: "worker",
    idleMilliseconds: 1_000
  })

  // When
  scheduler.start()
  await flush()
  const delayed = harness.persistence.repositories.jobs.get({ id: local.id })
  clock.advance(1_000)
  await flush()

  // Then
  expect(delayed).toMatchObject({
    state: "queued",
    nextAttemptAt: "2026-08-26T12:00:01.000Z",
    attemptCount: 1
  })
  expect(harness.persistence.repositories.jobs.get({ id: local.id })).toMatchObject({
    state: "succeeded",
    attemptCount: 2
  })
  expect(harness.persistence.repositories.jobs.get({ id: external.id })).toMatchObject({
    state: "failed",
    attemptCount: 1
  })
  await scheduler.stop()
  harness.close()
})
