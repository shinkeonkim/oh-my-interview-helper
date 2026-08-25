import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createApp } from "../src/app"
import type { JobDefinition } from "../src/jobs/runtime"
import { defaultLocalSecuritySettings } from "../src/security/config"

const directories: string[] = []
const localUrl = (path: string): string => `http://localhost:3000${path}`
const idempotencyKey = "00000000-0000-4000-8000-000000000001"
const definitions: readonly JobDefinition[] = [
  { kind: "test.local", retryClass: "local", maxAttempts: 1, run: async () => undefined }
]

const createDataDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-jobs-api-errors-"))
  directories.push(directory)
  return directory
}

const createJobsApp = (requestBytes?: number) => {
  const defaults = defaultLocalSecuritySettings()
  return createApp({
    dataDirectory: createDataDirectory(),
    jobDefinitions: definitions,
    security:
      requestBytes === undefined
        ? defaults
        : { ...defaults, requestBytes, fileBytes: Math.min(defaults.fileBytes, requestBytes) }
  })
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

const postJob = (
  app: ReturnType<typeof createApp>,
  csrfToken: { readonly cookie: string; readonly token: string },
  body: string,
  contentType = "application/json"
): Promise<Response> =>
  app.request(localUrl("/api/jobs"), {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      Cookie: csrfToken.cookie,
      "X-CSRF-Token": csrfToken.token
    },
    body
  })

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe("job enqueue HTTP error boundary", () => {
  const invalidRequests = [
    ["malformed JSON", '{"kind":}', "JOB_REQUEST_MALFORMED"],
    ["truncated JSON", '{"kind":"test.local"', "JOB_REQUEST_MALFORMED"],
    ["a non-object JSON body", "[]", "JOB_REQUEST_INVALID"],
    [
      "an invalid kind",
      JSON.stringify({ kind: " ", input: {}, idempotencyKey }),
      "JOB_REQUEST_INVALID"
    ],
    [
      "a client-selected execution target",
      JSON.stringify({ kind: "test.local", input: {}, idempotencyKey, executionTarget: "runner" }),
      "JOB_REQUEST_INVALID"
    ],
    [
      "an invalid idempotency key",
      JSON.stringify({ kind: "test.local", input: {}, idempotencyKey: "not-a-uuid" }),
      "JOB_REQUEST_INVALID"
    ],
    [
      "an invalid input shape",
      JSON.stringify({ kind: "test.local", input: [], idempotencyKey }),
      "JOB_REQUEST_INVALID"
    ]
  ] as const

  for (const [name, body, code] of invalidRequests)
    test(`returns a sanitized 400 for ${name}`, async () => {
      // Given
      const app = createJobsApp()
      const csrfToken = await csrf(app)

      // When
      const response = await postJob(app, csrfToken, body)

      // Then
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: { code } })
      expect(await app.request(localUrl("/api/jobs"))).toHaveProperty("status", 200)
    })

  test("returns a sanitized 400 for recursively secret-like keys and values", async () => {
    // Given
    const app = createJobsApp()
    const csrfToken = await csrf(app)
    const canary = "CANARY_SECRET_123"
    const body = JSON.stringify({
      kind: "test.local",
      input: { nested: [{ authorization: `Bearer ${canary}` }, { value: `sk-${canary}` }] },
      idempotencyKey
    })

    // When
    const response = await postJob(app, csrfToken, body)

    // Then
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: { code: "JOB_INPUT_SECRET_REJECTED" } })
    expect(await app.request(localUrl("/api/jobs"))).toHaveProperty("status", 200)
  })

  test("returns a sanitized 400 for a non-JSON content type", async () => {
    // Given
    const app = createJobsApp()
    const csrfToken = await csrf(app)
    const body = JSON.stringify({ kind: "test.local", input: {}, idempotencyKey })

    // When
    const response = await postJob(app, csrfToken, body, "text/plain")

    // Then
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: { code: "JOB_CONTENT_TYPE_INVALID" } })
  })

  test("retains the request size limit for JSON enqueue bodies", async () => {
    // Given
    const app = createJobsApp(128)
    const csrfToken = await csrf(app)
    const body = JSON.stringify({
      kind: "test.local",
      input: { value: "x".repeat(1024) },
      idempotencyKey
    })

    // When
    const response = await postJob(app, csrfToken, body)

    // Then
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: { code: "REQUEST_TOO_LARGE" } })
  })

  test("returns a sanitized 400 for an unknown job kind", async () => {
    // Given
    const app = createJobsApp()
    const csrfToken = await csrf(app)
    const body = JSON.stringify({ kind: "unknown", input: {}, idempotencyKey })

    // When
    const response = await postJob(app, csrfToken, body)

    // Then
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: { code: "UNKNOWN_JOB_KIND" } })
  })

  test("returns 409 for a divergent idempotency key", async () => {
    // Given
    const app = createJobsApp()
    const csrfToken = await csrf(app)
    const first = JSON.stringify({ kind: "test.local", input: { value: "first" }, idempotencyKey })
    const second = JSON.stringify({
      kind: "test.local",
      input: { value: "second" },
      idempotencyKey
    })
    expect((await postJob(app, csrfToken, first)).status).toBe(201)

    // When
    const response = await postJob(app, csrfToken, second)

    // Then
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: { code: "IDEMPOTENCY_CONFLICT" } })
  })

  test("retains CSRF rejection before request parsing", async () => {
    // Given
    const app = createJobsApp()

    // When
    const response = await app.request(localUrl("/api/jobs"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"kind":}'
    })

    // Then
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: { code: "CSRF_INVALID" } })
  })
})
