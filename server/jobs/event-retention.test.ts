import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPersistence } from "../src/db"

const directories: string[] = []
const timestamp = "2026-08-26T12:00:00.000Z"

const createHarness = () => {
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-event-retention-"))
  directories.push(directory)
  const persistence = createPersistence({ dataDirectory: directory })
  const job = persistence.repositories.jobs.enqueue({
    id: crypto.randomUUID(),
    kind: "test.local",
    input: {},
    idempotencyKey: crypto.randomUUID(),
    retryClass: "local",
    maxAttempts: 1,
    now: timestamp
  }).job
  return { job, persistence }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

test("retains only eligible progress events without reusing sequence numbers or silently replaying gaps", () => {
  // Given
  const { job, persistence } = createHarness()
  const jobs = persistence.repositories.jobs
  jobs.claim({ owner: "worker", now: timestamp, leaseMilliseconds: 30_000 })
  jobs.start({ id: job.id, owner: "worker", now: "2026-08-26T12:00:01.000Z" })
  const expired = jobs.appendProgress({
    id: job.id,
    payload: { step: "expired" },
    now: "2026-08-26T12:00:02.000Z"
  })
  const prunedByCount = jobs.appendProgress({
    id: job.id,
    payload: { step: "count" },
    now: "2026-08-26T12:00:04.000Z"
  })
  const retained = jobs.appendProgress({
    id: job.id,
    payload: { step: "retained" },
    now: "2026-08-26T12:00:04.500Z"
  })

  // When
  jobs.retainEvents({
    id: job.id,
    now: "2026-08-26T12:00:05.000Z",
    progressLimit: 1,
    progressMaxAgeMilliseconds: 1_000
  })
  const later = jobs.appendProgress({
    id: job.id,
    payload: { step: "later" },
    now: "2026-08-26T12:00:06.000Z"
  })

  // Then
  expect(jobs.events({ id: job.id }).map((event) => [event.kind, event.sequence])).toEqual([
    ["queued", 1],
    ["leased", 2],
    ["running", 3],
    ["progress", retained.sequence],
    ["progress", later.sequence]
  ])
  expect(later.sequence).toBe(7)
  expect(jobs.eventsAfter({ id: job.id, eventId: expired.id })).toEqual({
    kind: "reset",
    code: "EVENT_REPLAY_GAP"
  })
  expect(jobs.eventsAfter({ id: job.id, eventId: prunedByCount.id })).toEqual({
    kind: "reset",
    code: "EVENT_REPLAY_GAP"
  })
  expect(jobs.eventsAfter({ id: job.id, eventId: retained.id })).toEqual({
    kind: "events",
    events: [later]
  })
  const queued = jobs.events({ id: job.id })[0]
  if (queued === undefined) throw new Error("Missing queued event")
  expect(() =>
    persistence.database.run("DELETE FROM durable_job_events WHERE id=?", [queued.id])
  ).toThrow()
  expect(
    persistence.repositories.operations.appendJobEvent({
      id: crypto.randomUUID(),
      jobId: job.id,
      kind: "audit",
      payload: {}
    }).sequence
  ).toBe(8)
  expect(() =>
    jobs.retainEvents({
      id: job.id,
      now: "2026-08-26T12:00:06.000Z",
      progressLimit: -1,
      progressMaxAgeMilliseconds: 0
    })
  ).toThrow("EVENT_RETENTION_INVALID")
  persistence.close()
})

test("returns the same typed reset for unknown and cross-job cursors", () => {
  // Given
  const first = createHarness()
  const second = createHarness()
  const firstEvent = first.persistence.repositories.jobs.events({ id: first.job.id })[0]
  const secondEvent = second.persistence.repositories.jobs.events({ id: second.job.id })[0]
  if (firstEvent === undefined || secondEvent === undefined) throw new Error("Missing queued event")

  // When
  const unknown = first.persistence.repositories.jobs.eventsAfter({
    id: first.job.id,
    eventId: crypto.randomUUID()
  })
  const crossJob = first.persistence.repositories.jobs.eventsAfter({
    id: first.job.id,
    eventId: secondEvent.id
  })

  // Then
  expect(unknown).toEqual({ kind: "reset", code: "EVENT_REPLAY_GAP" })
  expect(crossJob).toEqual({ kind: "reset", code: "EVENT_REPLAY_GAP" })
  expect(
    first.persistence.repositories.jobs.eventsAfter({ id: first.job.id, eventId: firstEvent.id })
  ).toEqual({
    kind: "events",
    events: []
  })
  first.persistence.close()
  second.persistence.close()
})

test("rolls back a terminal state transition when its immutable terminal event cannot append", () => {
  // Given
  const { job, persistence } = createHarness()
  const jobs = persistence.repositories.jobs
  jobs.claim({ owner: "worker", now: timestamp, leaseMilliseconds: 30_000 })
  jobs.start({ id: job.id, owner: "worker", now: "2026-08-26T12:00:01.000Z" })
  persistence.database.exec(
    "CREATE TRIGGER reject_succeeded_event BEFORE INSERT ON durable_job_events WHEN NEW.event_kind='succeeded' BEGIN SELECT RAISE(ABORT,'event rejected'); END"
  )

  // When / Then
  expect(() =>
    jobs.succeed({ id: job.id, owner: "worker", now: "2026-08-26T12:00:02.000Z" })
  ).toThrow("event rejected")
  expect(jobs.get({ id: job.id })).toMatchObject({ state: "running" })
  expect(jobs.events({ id: job.id }).filter((event) => event.kind === "succeeded")).toHaveLength(0)
  persistence.close()
})
