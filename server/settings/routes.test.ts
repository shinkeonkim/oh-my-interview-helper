import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ProviderRegistry, type ProviderRegistration } from "../src/agents"
import { createApp } from "../src/app"
import { createPersistence, type Persistence } from "../src/db"

const directories: string[] = []
const handles: Persistence[] = []
const localUrl = (path: string): string => `http://localhost:3000${path}`

const setup = (): {
  readonly app: ReturnType<typeof createApp>
  readonly persistence: Persistence
  readonly healthCalls: () => number
} => {
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-settings-"))
  directories.push(directory)
  const persistence = createPersistence({ dataDirectory: directory })
  handles.push(persistence)
  let healthCalls = 0
  const provider: ProviderRegistration = {
    descriptor: {
      id: "fake",
      mode: "test",
      model: { id: "fake-model", displayName: "Fake", maxOutputTokens: 128 },
      capabilities: { generation: true, structuredOutput: true, citedResearch: false }
    },
    enabled: true,
    createModel: () => {
      throw new Error("settings must not construct models")
    },
    health: async () => {
      healthCalls += 1
      return { kind: "healthy" }
    }
  }
  const app = createApp({ persistence, providerRegistry: new ProviderRegistry([provider]) })
  return { app, persistence, healthCalls: () => healthCalls }
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
    throw new Error("csrf response invalid")
  return { cookie, token: body.csrfToken }
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe("provider settings and status routes", () => {
  test("persists only non-secret settings and returns status without probing a provider", async () => {
    // Given
    const harness = setup()
    const tokens = await csrf(harness.app)

    // When
    const secret = await harness.app.request(localUrl("/api/settings/providers/fake"), {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: tokens.cookie,
        "x-csrf-token": tokens.token
      },
      body: JSON.stringify({
        selectedModel: "fake-model",
        enabled: true,
        capabilities: { apiKey: "canary" }
      })
    })
    const saved = await harness.app.request(localUrl("/api/settings/providers/fake"), {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: tokens.cookie,
        "x-csrf-token": tokens.token
      },
      body: JSON.stringify({
        selectedModel: "fake-model",
        enabled: true,
        capabilities: { generation: true }
      })
    })
    const status = await harness.app.request(localUrl("/api/providers/status"))

    // Then
    expect(secret.status).toBe(400)
    expect(saved.status).toBe(200)
    expect(harness.healthCalls()).toBe(0)
    expect(await status.json()).toEqual({
      providers: [
        expect.objectContaining({ id: "fake", configured: true, health: { kind: "not_checked" } })
      ]
    })
  })

  test("does not return a raw database canary from persisted settings", async () => {
    // Given
    const harness = setup()
    harness.persistence.database.run(
      "INSERT INTO provider_settings (provider_kind,selected_model,enabled,capability_json,updated_at) VALUES (?,?,?,?,?)",
      ["raw", "model", 1, '{"token":"canary-db-secret"}', "2026-08-26T12:00:00.000Z"]
    )

    // When
    const response = await harness.app.request(localUrl("/api/settings/providers"))
    const body = await response.text()

    // Then
    expect(response.status).toBe(400)
    expect(body).not.toContain("canary-db-secret")
  })
})
