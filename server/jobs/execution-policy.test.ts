import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPersistence } from "../src/db"
import { OperationsRepositories } from "../src/db/operations-repositories"
import { JobScheduler } from "../src/jobs/scheduler"
import { createHarness, flush, ManualClock } from "./scheduler-test-support"

test("keeps runner jobs queued while the app scheduler executes app work", async () => {
  // Given
  const clock = new ManualClock()
  let appRuns = 0
  let runnerRuns = 0
  const harness = createHarness([
    {
      kind: "app",
      retryClass: "local",
      executionTarget: "app",
      maxAttempts: 1,
      run: async () => {
        appRuns++
      }
    },
    {
      kind: "runner",
      retryClass: "local",
      executionTarget: "runner",
      maxAttempts: 1,
      run: async () => {
        runnerRuns++
      }
    }
  ])
  const runner = harness.runtime.enqueue({
    kind: "runner",
    input: {},
    idempotencyKey: crypto.randomUUID()
  })
  harness.runtime.enqueue({ kind: "app", input: {}, idempotencyKey: crypto.randomUUID() })
  const scheduler = new JobScheduler(harness.runtime, { clock, idleMilliseconds: 1 })

  // When
  scheduler.start()
  await flush()

  // Then
  expect(appRuns).toBe(1)
  expect(runnerRuns).toBe(0)
  expect(harness.persistence.repositories.jobs.get({ id: runner.id })).toMatchObject({
    state: "queued",
    executionTarget: "runner"
  })
  await scheduler.stop()
  harness.close()
})

test("rejects low-level terminal jobs, terminal events, and secret inputs", () => {
  // Given
  const directory = mkdtempSync(join(tmpdir(), "execution-policy-"))
  const persistence = createPersistence({ dataDirectory: directory })
  const operations = new OperationsRepositories(persistence.database)
  const id = crypto.randomUUID()
  const createJob = Reflect.get(operations, "createJob")
  if (typeof createJob !== "function") throw new Error("Operations job creation is unavailable")

  // When / Then
  expect(() =>
    Reflect.apply(createJob, operations, [
      {
        id,
        kind: "legacy",
        state: "succeeded",
        idempotencyKey: crypto.randomUUID(),
        payload: {},
        retryClass: "local",
        executionTarget: "app",
        maxAttempts: 1
      }
    ])
  ).toThrow()
  expect(() =>
    operations.createJob({
      id,
      kind: "legacy",
      state: "queued",
      idempotencyKey: crypto.randomUUID(),
      payload: { apiKey: "canary" },
      retryClass: "local",
      executionTarget: "app",
      maxAttempts: 1
    })
  ).toThrow()
  const job = operations.createJob({
    id,
    kind: "legacy",
    state: "queued",
    idempotencyKey: crypto.randomUUID(),
    payload: {},
    retryClass: "local",
    executionTarget: "app",
    maxAttempts: 1
  })
  expect(() =>
    operations.appendJobEvent({
      id: crypto.randomUUID(),
      jobId: job.id,
      kind: "succeeded",
      payload: {}
    })
  ).toThrow()
  persistence.close()
  rmSync(directory, { force: true, recursive: true })
})
