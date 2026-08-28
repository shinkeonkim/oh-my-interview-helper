import { expect, test } from "bun:test"

import { JobScheduler } from "../src/jobs/scheduler"
import { createHarness, flush, ManualClock } from "./scheduler-test-support"

test("does not succeed when a SIGTERM-aware handler returns after shutdown abort", async () => {
  // Given
  const clock = new ManualClock()
  const harness = createHarness([
    {
      kind: "local",
      retryClass: "local",
      maxAttempts: 2,
      run: async ({ signal }) =>
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", resolve, { once: true })
        )
    }
  ])
  const job = harness.runtime.enqueue({
    kind: "local",
    input: {},
    idempotencyKey: crypto.randomUUID()
  })
  const scheduler = new JobScheduler(harness.runtime, { clock, shutdownGraceMilliseconds: 25 })

  // When
  scheduler.start()
  await flush()
  const stopping = scheduler.stop()
  clock.advance(25)
  await stopping

  // Then
  expect(harness.persistence.repositories.jobs.get({ id: job.id })).toMatchObject({
    state: "queued",
    lastErrorCode: "interrupted"
  })
  expect(clock.pending()).toBe(0)
  harness.close()
})
