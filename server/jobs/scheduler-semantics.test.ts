import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPersistence } from "../src/db"
import { JobRuntime, createJobRegistry, type JobDefinition } from "../src/jobs/runtime"
import { JobScheduler } from "../src/jobs/scheduler"
import { barrier, ManualClock } from "./scheduler-test-support"

const directories: string[] = []

const createHarness = (definitions: readonly JobDefinition[]) => {
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-job-semantics-"))
  directories.push(directory)
  const persistence = createPersistence({ dataDirectory: directory })
  const runtime = new JobRuntime(persistence.repositories.jobs, createJobRegistry(definitions))
  return { persistence, runtime }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

test("renews an active lease until a healthy long handler succeeds", async () => {
  // Given
  const clock = new ManualClock()
  const handlerStarted = barrier()
  const completion = barrier()
  const { persistence, runtime } = createHarness([
    {
      kind: "test.long",
      retryClass: "local",
      maxAttempts: 1,
      run: async () => {
        handlerStarted.release()
        await completion.wait
      }
    }
  ])
  const scheduler = new JobScheduler(runtime, {
    clock,
    concurrency: 1,
    idleMilliseconds: 5,
    leaseMilliseconds: 20,
    heartbeatMilliseconds: 5
  })
  const job = runtime.enqueue({ kind: "test.long", input: {}, idempotencyKey: crypto.randomUUID() })

  // When
  scheduler.start()
  await handlerStarted.wait
  clock.advance(40)
  const recovered = persistence.repositories.jobs.recoverExpired({ now: clock.now().toISOString() })
  const stopping = scheduler.stop()
  completion.release()
  await stopping

  // Then
  expect(recovered).toEqual([])
  expect(persistence.repositories.jobs.get({ id: job.id })).toMatchObject({ state: "succeeded" })
  expect(clock.pending()).toBe(0)
  persistence.close()
})

test("returns a replay reset contract when retention prunes a progress event", () => {
  // Given
  const { persistence } = createHarness([])
  const job = persistence.repositories.jobs.enqueue({
    id: crypto.randomUUID(),
    kind: "test.local",
    input: {},
    idempotencyKey: crypto.randomUUID(),
    retryClass: "local",
    maxAttempts: 1,
    now: "2026-08-26T12:00:00.000Z"
  }).job

  // When
  persistence.repositories.jobs.retainEvents({
    id: job.id,
    now: "2026-08-26T12:00:00.000Z",
    progressLimit: 0,
    progressMaxAgeMilliseconds: 0
  })

  // Then
  expect(
    persistence.repositories.jobs.eventsAfter({ id: job.id, eventId: crypto.randomUUID() })
  ).toEqual({
    kind: "reset",
    code: "EVENT_REPLAY_GAP"
  })
  persistence.close()
})
