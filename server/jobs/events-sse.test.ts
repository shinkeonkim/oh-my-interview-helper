import { expect, test } from "bun:test"
import { Hono } from "hono"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createApp } from "../src/app"
import { createPersistence } from "../src/db"
import { createJobRegistry, JobRuntime, type JobDefinition } from "../src/jobs/runtime"
import { createJobsRoutes } from "../src/routes/jobs"

const localUrl = (path: string): string => `http://localhost:3000${path}`
const definitions: readonly JobDefinition[] = [
  { kind: "test.local", retryClass: "local", maxAttempts: 1, run: async () => undefined }
]

const createHarness = () => {
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-events-sse-"))
  const persistence = createPersistence({ dataDirectory: directory })
  const runtime = new JobRuntime(persistence.repositories.jobs, createJobRegistry(definitions))
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
    persistence,
    runtime,
    close: (): void => {
      persistence.close()
      rmSync(directory, { force: true, recursive: true })
    }
  }
}

const terminalJob = (harness: ReturnType<typeof createHarness>): void => {
  harness.persistence.repositories.jobs.claim({
    owner: "worker",
    now: "2026-08-26T12:00:00.000Z",
    leaseMilliseconds: 30_000
  })
  harness.persistence.repositories.jobs.start({
    id: harness.job.id,
    owner: "worker",
    now: "2026-08-26T12:00:01.000Z"
  })
  harness.persistence.repositories.jobs.succeed({
    id: harness.job.id,
    owner: "worker",
    now: "2026-08-26T12:00:02.000Z"
  })
}

test("returns ordered JSON polling replay strictly after a valid Last-Event-ID", async () => {
  // Given
  const harness = createHarness()
  terminalJob(harness)
  const first = harness.persistence.repositories.jobs.events({ id: harness.job.id })[0]
  if (first === undefined) throw new Error("Missing queued event")
  const app = createApp({ persistence: harness.persistence, jobRuntime: harness.runtime })

  // When
  const response = await app.request(
    localUrl(`/api/jobs/${harness.job.id}/events?transport=poll`),
    {
      headers: { "Last-Event-ID": first.id }
    }
  )

  // Then
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    events: harness.persistence.repositories.jobs.events({ id: harness.job.id }).slice(1)
  })
  harness.close()
})

test("returns typed HTTP gaps for malformed, unknown, and cross-job cursors", async () => {
  // Given
  const harness = createHarness()
  terminalJob(harness)
  const other = harness.persistence.repositories.jobs.enqueue({
    id: crypto.randomUUID(),
    kind: "test.local",
    input: {},
    idempotencyKey: crypto.randomUUID(),
    retryClass: "local",
    maxAttempts: 1,
    now: "2026-08-26T12:00:03.000Z"
  }).job
  const otherEvent = harness.persistence.repositories.jobs.events({ id: other.id })[0]
  if (otherEvent === undefined) throw new Error("Missing cross-job event")
  const app = createApp({ persistence: harness.persistence, jobRuntime: harness.runtime })
  const request = (eventId: string) =>
    app.request(localUrl(`/api/jobs/${harness.job.id}/events?transport=poll`), {
      headers: { "Last-Event-ID": eventId }
    })

  // When
  const malformed = await request("not-an-event-id")
  const unknown = await request(crypto.randomUUID())
  const crossJob = await request(otherEvent.id)

  // Then
  expect(malformed.status).toBe(400)
  expect(await malformed.json()).toEqual({ error: { code: "LAST_EVENT_ID_INVALID" } })
  expect(unknown.status).toBe(409)
  expect(await unknown.json()).toEqual({ error: { code: "EVENT_REPLAY_GAP" } })
  expect(crossJob.status).toBe(409)
  expect(await crossJob.json()).toEqual({ error: { code: "EVENT_REPLAY_GAP" } })
  harness.close()
})

test("buffers an event inserted between replay snapshot and live handoff without duplication", async () => {
  // Given
  const harness = createHarness()
  let insertedId: string | null = null
  const app = new Hono().route(
    "/api/jobs",
    createJobsRoutes(harness.runtime, {
      afterReplaySnapshot: (id) => {
        insertedId = harness.runtime.reportProgress(id, { step: "handoff" }).id
      },
      heartbeatMilliseconds: 1
    })
  )

  // When
  const response = await app.request(localUrl(`/api/jobs/${harness.job.id}/events`))
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error("SSE response body is missing")
  const first = await reader.read()
  const second = await reader.read()
  await reader.cancel()

  // Then
  expect(insertedId).not.toBeNull()
  const output = new TextDecoder().decode(first.value) + new TextDecoder().decode(second.value)
  expect(output.match(/event: progress/g)).toHaveLength(1)
  expect(output.indexOf("event: queued")).toBeLessThan(output.indexOf("event: progress"))
  harness.close()
})

test("applies local Host and Origin restrictions to non-mutating SSE requests", async () => {
  // Given
  const harness = createHarness()
  terminalJob(harness)
  const app = createApp({ persistence: harness.persistence, jobRuntime: harness.runtime })

  // When
  const hostileHost = await app.request(`http://attacker.invalid/api/jobs/${harness.job.id}/events`)
  const hostileOrigin = await app.request(localUrl(`/api/jobs/${harness.job.id}/events`), {
    headers: { Origin: "https://attacker.invalid" }
  })

  // Then
  expect(hostileHost.status).toBe(421)
  expect(hostileOrigin.status).toBe(403)
  harness.close()
})
