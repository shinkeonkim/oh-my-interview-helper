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
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-terminal-sse-"))
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
  persistence.repositories.jobs.claim({
    owner: "worker",
    now: "2026-08-26T12:00:00.000Z",
    leaseMilliseconds: 30_000
  })
  persistence.repositories.jobs.start({
    id: job.id,
    owner: "worker",
    now: "2026-08-26T12:00:01.000Z"
  })
  persistence.repositories.jobs.succeed({
    id: job.id,
    owner: "worker",
    now: "2026-08-26T12:00:02.000Z"
  })
  return {
    job,
    runtime,
    events: persistence.repositories.jobs.events({ id: job.id }),
    close: (): void => {
      persistence.close()
      rmSync(directory, { force: true, recursive: true })
    }
  }
}

test("closes terminal SSE replays without subscribing for no, pre-terminal, and terminal cursors", async () => {
  // Given
  const harness = createHarness()
  const terminal = harness.events.at(-1)
  const preTerminal = harness.events.at(-2)
  if (terminal === undefined || preTerminal === undefined)
    throw new Error("Missing terminal history")
  let subscribed = 0
  const app = new Hono().route(
    "/api/jobs",
    createJobsRoutes(harness.runtime, {
      heartbeatMilliseconds: 1,
      onSubscribe: () => {
        subscribed++
      }
    })
  )
  const request = (eventId?: string) =>
    app.request(localUrl(`/api/jobs/${harness.job.id}/events`), {
      headers: eventId === undefined ? {} : { "Last-Event-ID": eventId }
    })

  // When
  const noCursor = await request()
  const preTerminalCursor = await request(preTerminal.id)
  const terminalCursor = await request(terminal.id)
  const terminalReader = terminalCursor.body?.getReader()
  if (terminalReader === undefined) throw new Error("Terminal SSE body is missing")
  const terminalFrame = await terminalReader.read()
  if (!terminalFrame.done) await terminalReader.cancel()

  // Then
  expect(await noCursor.text()).toContain("event: succeeded")
  expect(await preTerminalCursor.text()).toContain("event: succeeded")
  expect(terminalFrame.done).toBe(true)
  expect(subscribed).toBe(0)
  harness.close()
})

test("keeps polling parity and returns reset contracts for terminal replay gaps", async () => {
  // Given
  const harness = createHarness()
  const terminal = harness.events.at(-1)
  if (terminal === undefined) throw new Error("Missing terminal event")
  const other = harness.runtime.repository.enqueue({
    id: crypto.randomUUID(),
    kind: "test.local",
    input: {},
    idempotencyKey: crypto.randomUUID(),
    retryClass: "local",
    maxAttempts: 1,
    now: "2026-08-26T12:00:03.000Z"
  }).job
  const crossJob = harness.runtime.repository.events({ id: other.id })[0]
  if (crossJob === undefined) throw new Error("Missing cross-job event")
  const app = new Hono().route("/api/jobs", createJobsRoutes(harness.runtime))
  const request = (transport: "poll" | "sse", eventId: string) =>
    app.request(localUrl(`/api/jobs/${harness.job.id}/events?transport=${transport}`), {
      headers: { "Last-Event-ID": eventId }
    })

  // When
  const poll = await request("poll", terminal.id)
  const unknown = await request("sse", crypto.randomUUID())
  const cross = await request("sse", crossJob.id)

  // Then
  expect(poll.status).toBe(200)
  expect(await poll.json()).toEqual({ events: [] })
  expect(unknown.status).toBe(409)
  expect(await unknown.json()).toEqual({ error: { code: "EVENT_REPLAY_GAP" } })
  expect(cross.status).toBe(409)
  expect(await cross.json()).toEqual({ error: { code: "EVENT_REPLAY_GAP" } })
  harness.close()
})
