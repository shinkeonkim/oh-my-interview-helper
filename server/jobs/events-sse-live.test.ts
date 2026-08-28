import { expect, test } from "bun:test"
import { Hono } from "hono"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPersistence } from "../src/db"
import { createJobRegistry, JobRuntime } from "../src/jobs/runtime"
import { createJobsRoutes } from "../src/routes/jobs"

const localUrl = (path: string): string => `http://localhost:3000${path}`

const createHarness = () => {
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-events-live-"))
  const persistence = createPersistence({ dataDirectory: directory })
  const runtime = new JobRuntime(persistence.repositories.jobs, createJobRegistry([]))
  const job = persistence.repositories.jobs.enqueue({
    id: crypto.randomUUID(),
    kind: "test.local",
    input: {},
    idempotencyKey: crypto.randomUUID(),
    retryClass: "local",
    maxAttempts: 1,
    now: "2026-08-26T12:00:00.000Z"
  }).job
  return {
    job,
    runtime,
    close: (): void => {
      persistence.close()
      rmSync(directory, { force: true, recursive: true })
    }
  }
}

const readerFor = async (
  app: Hono,
  id: string
): Promise<ReadableStreamDefaultReader<Uint8Array>> => {
  const response = await app.request(localUrl(`/api/jobs/${id}/events`))
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error("SSE response body is missing")
  return reader
}

test("delivers heartbeat comments and removes disconnected live subscribers", async () => {
  // Given
  const harness = createHarness()
  let unsubscribed = 0
  const app = new Hono().route(
    "/api/jobs",
    createJobsRoutes(harness.runtime, {
      heartbeatMilliseconds: 1,
      onUnsubscribe: () => {
        unsubscribed++
      }
    })
  )
  const reader = await readerFor(app, harness.job.id)

  // When
  const initial = await reader.read()
  const heartbeat = await reader.read()
  await reader.cancel()

  // Then
  expect(new TextDecoder().decode(initial.value)).toContain("event: queued")
  expect(new TextDecoder().decode(heartbeat.value)).toBe(": heartbeat\n\n")
  expect(unsubscribed).toBe(1)
  harness.close()
})

test("fans out one job's live event to multiple subscribers without cross-job delivery", async () => {
  // Given
  const harness = createHarness()
  const other = harness.runtime.repository.enqueue({
    id: crypto.randomUUID(),
    kind: "test.local",
    input: {},
    idempotencyKey: crypto.randomUUID(),
    retryClass: "local",
    maxAttempts: 1,
    now: "2026-08-26T12:00:01.000Z"
  }).job
  const app = new Hono().route(
    "/api/jobs",
    createJobsRoutes(harness.runtime, { heartbeatMilliseconds: 1 })
  )
  const first = await readerFor(app, harness.job.id)
  const second = await readerFor(app, harness.job.id)
  await Promise.all([first.read(), second.read()])

  // When
  harness.runtime.reportProgress(other.id, { step: "other" })
  const progress = harness.runtime.reportProgress(harness.job.id, { step: "shared" })
  const [firstEvent, secondEvent] = await Promise.all([first.read(), second.read()])
  await Promise.all([first.cancel(), second.cancel()])

  // Then
  expect(new TextDecoder().decode(firstEvent.value)).toContain(`id: ${progress.id}`)
  expect(new TextDecoder().decode(secondEvent.value)).toContain(`id: ${progress.id}`)
  expect(new TextDecoder().decode(firstEvent.value)).not.toContain(other.id)
  harness.close()
})

test("closes an overflowed subscriber and replays durable events after reconnect", async () => {
  // Given
  const harness = createHarness()
  const queued = harness.runtime.repository.events({ id: harness.job.id })[0]
  if (queued === undefined) throw new Error("Missing queued event")
  let unsubscribed = 0
  let overflow: { readonly code: string; readonly lastEventId: string | null } | null = null
  const app = new Hono().route(
    "/api/jobs",
    createJobsRoutes(harness.runtime, {
      maxBufferedEvents: 0,
      onOverflow: (_id, signal) => {
        overflow = signal
      },
      onUnsubscribe: () => {
        unsubscribed++
      }
    })
  )
  const reader = await readerFor(app, harness.job.id)
  await reader.read()

  // When
  const progress = harness.runtime.reportProgress(harness.job.id, { step: "reconnect" })
  const closed = await reader.read()
  const replayApp = new Hono().route("/api/jobs", createJobsRoutes(harness.runtime))
  const reconnected = await replayApp.request(localUrl(`/api/jobs/${harness.job.id}/events`), {
    headers: { "Last-Event-ID": queued.id }
  })
  const reconnectReader = reconnected.body?.getReader()
  if (reconnectReader === undefined) throw new Error("Reconnect SSE response body is missing")
  const replayed = await reconnectReader.read()
  await reconnectReader.cancel()

  // Then
  expect(closed.done).toBe(true)
  expect(overflow).toEqual({ code: "EVENT_REPLAY_REQUIRED", lastEventId: null })
  expect(unsubscribed).toBe(1)
  expect(new TextDecoder().decode(replayed.value)).toContain(`id: ${progress.id}`)
  harness.close()
})
