import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPersistence } from "../src/db"
import { JobRuntime, createJobRegistry } from "../src/jobs/runtime"
import { JobScheduler } from "../src/jobs/scheduler"

test("fails an unregistered claimed job rather than leaving it running", async () => {
  // Given
  const dataDirectory = mkdtempSync(join(tmpdir(), "scheduler-red-"))
  const persistence = createPersistence({ dataDirectory })
  const job = persistence.repositories.jobs.enqueue({
    id: crypto.randomUUID(),
    kind: "missing.handler",
    input: {},
    idempotencyKey: crypto.randomUUID(),
    retryClass: "external",
    maxAttempts: 1,
    now: "2026-08-26T12:00:00.000Z"
  }).job
  const scheduler = new JobScheduler(
    new JobRuntime(persistence.repositories.jobs, createJobRegistry([])),
    { idleMilliseconds: 1 }
  )

  // When
  scheduler.start()
  await Promise.resolve()
  await Promise.resolve()
  await scheduler.stop()

  // Then
  expect(persistence.repositories.jobs.get({ id: job.id })).toMatchObject({
    state: "failed",
    errorCode: "handler_missing"
  })
  persistence.close()
  rmSync(dataDirectory, { force: true, recursive: true })
})
