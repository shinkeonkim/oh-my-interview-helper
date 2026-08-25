import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createApp } from "../src/app"
import { createPersistence } from "../src/db"
import type { JobDefinition } from "../src/jobs/runtime"

const directories: string[] = []
const localUrl = (path: string): string => `http://localhost:3000${path}`
const definitions: readonly JobDefinition[] = [
  { kind: "test.local", retryClass: "local", maxAttempts: 2, run: async () => undefined }
]

const createDataDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-jobs-api-"))
  directories.push(directory)
  return directory
}

const csrf = async (
  app: ReturnType<typeof createApp>
): Promise<{ readonly cookie: string; readonly token: string }> => {
  const response = await app.request(localUrl("/api/security/csrf"))
  const body: unknown = await response.json()
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0]
  if (
    cookie === undefined ||
    typeof body !== "object" ||
    body === null ||
    !("csrfToken" in body) ||
    typeof body.csrfToken !== "string"
  )
    throw new Error("CSRF bootstrap contract violated")
  return { cookie, token: body.csrfToken }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe("durable job HTTP and SSE API", () => {
  test("enqueues a canonical job only with signed CSRF and exposes it through list and get routes", async () => {
    // Given
    const app = createApp({ dataDirectory: createDataDirectory(), jobDefinitions: definitions })
    const csrfToken = await csrf(app)
    const body = {
      kind: "test.local",
      input: { label: "safe metadata" },
      idempotencyKey: crypto.randomUUID()
    }

    // When
    const created = await app.request(localUrl("/api/jobs"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: csrfToken.cookie,
        "X-CSRF-Token": csrfToken.token
      },
      body: JSON.stringify(body)
    })

    // Then
    expect(created.status).toBe(201)
    const job: unknown = await created.json()
    expect(job).toMatchObject({ state: "queued", kind: body.kind })
  })

  test("rejects an untrusted Host, Origin, CSRF pair, and unknown handler kind without creating a job", async () => {
    // Given
    const app = createApp({ dataDirectory: createDataDirectory(), jobDefinitions: definitions })
    const body = JSON.stringify({ kind: "unknown", input: {}, idempotencyKey: crypto.randomUUID() })

    // When
    const hostileHost = await app.request("http://attacker.invalid/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    })
    const hostileOrigin = await app.request(localUrl("/api/jobs"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.invalid" },
      body
    })

    // Then
    expect(hostileHost.status).toBe(421)
    expect(hostileOrigin.status).toBe(403)
    expect(await app.request(localUrl("/api/jobs"))).toHaveProperty("status", 200)
  })

  test("replays immutable events after Last-Event-ID in strict order and closes on a terminal job", async () => {
    // Given
    const persistence = createPersistence({ dataDirectory: createDataDirectory() })
    const app = createApp({ persistence, jobDefinitions: definitions })
    const job = persistence.repositories.jobs.enqueue({
      id: crypto.randomUUID(),
      kind: "test.local",
      input: { label: "terminal" },
      idempotencyKey: crypto.randomUUID(),
      retryClass: "local",
      maxAttempts: 1,
      now: "2026-08-26T12:00:00.000Z"
    }).job
    const lease = persistence.repositories.jobs.claim({
      owner: "worker-a",
      now: "2026-08-26T12:00:00.000Z",
      leaseMilliseconds: 30_000
    }).job
    persistence.repositories.jobs.start({
      id: lease.id,
      owner: "worker-a",
      now: "2026-08-26T12:00:01.000Z"
    })
    persistence.repositories.jobs.succeed({
      id: lease.id,
      owner: "worker-a",
      now: "2026-08-26T12:00:02.000Z"
    })

    // When
    const stream = await app.request(localUrl(`/api/jobs/${job.id}/events`))

    // Then
    expect(stream.status).toBe(200)
    expect(stream.headers.get("content-type")).toContain("text/event-stream")
    expect(await stream.text()).toContain("event: succeeded")
    persistence.close()
  })
})
