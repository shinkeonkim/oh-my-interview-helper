import { expect, test } from "bun:test"

import { JobScheduler } from "../src/jobs/scheduler"
import { barrier, createHarness, flush, ManualClock } from "./scheduler-test-support"

test("cancellation wins when a running external handler reaches its timeout", async () => {
  // Given
  const clock = new ManualClock()
  const never = barrier()
  const harness = createHarness([
    { kind: "external", retryClass: "external", maxAttempts: 1, run: async () => never.wait }
  ])
  const job = harness.runtime.enqueue({
    kind: "external",
    input: {},
    idempotencyKey: crypto.randomUUID()
  })
  const scheduler = new JobScheduler(harness.runtime, {
    clock,
    owner: "worker",
    idleMilliseconds: 1,
    handlerTimeoutMilliseconds: 5
  })

  // When
  scheduler.start()
  await flush()
  harness.runtime.cancel(job.id)
  clock.advance(5)
  await flush()

  // Then
  expect(harness.persistence.repositories.jobs.get({ id: job.id })).toMatchObject({
    state: "cancelled"
  })
  expect(
    harness.persistence.repositories.jobs
      .events({ id: job.id })
      .filter((event) => ["succeeded", "failed", "cancelled"].includes(event.kind))
  ).toHaveLength(1)
  never.release()
  await scheduler.stop()
  expect(clock.pending()).toBe(0)
  harness.close()
})
