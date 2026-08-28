import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ProviderIdSchema, ProviderRegistry, type ProviderRegistration } from "../src/agents"
import { createApp } from "../src/app"
import { createPersistence, type Persistence } from "../src/db"

const directories: string[] = []
const handles: Persistence[] = []
const timestamp = "2026-08-26T12:00:00.000Z"
const localUrl = (path: string): string => `http://localhost:3000${path}`
const hash = (character: string): string => character.repeat(64)
const setup = (): {
  readonly app: ReturnType<typeof createApp>
  readonly documentVersionId: string
  readonly providerCalls: () => { readonly model: number; readonly health: number }
} => {
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-artifact-routes-"))
  directories.push(directory)
  const persistence = createPersistence({ dataDirectory: directory })
  handles.push(persistence)
  const documentId = crypto.randomUUID()
  const documentVersionId = crypto.randomUUID()
  persistence.database.run(
    "INSERT INTO blobs (sha256,byte_size,media_type,created_at) VALUES (?,?,?,?)",
    [hash("a"), 1, "text/plain", timestamp]
  )
  persistence.database.run("INSERT INTO documents (id,kind,title,created_at) VALUES (?,?,?,?)", [
    documentId,
    "resume",
    "Resume",
    timestamp
  ])
  persistence.database.run(
    "INSERT INTO document_versions (id,document_id,version_number,blob_hash,created_at) VALUES (?,?,?,?,?)",
    [documentVersionId, documentId, 1, hash("a"), timestamp]
  )
  persistence.database.run("UPDATE documents SET current_version_id=? WHERE id=?", [
    documentVersionId,
    documentId
  ])
  let model = 0
  let health = 0
  const provider: ProviderRegistration = {
    descriptor: {
      id: ProviderIdSchema.parse("fake"),
      mode: "test",
      model: { id: "fake-model", displayName: "Fake", maxOutputTokens: 128 },
      capabilities: { generation: true, structuredOutput: true, citedResearch: false }
    },
    enabled: true,
    createModel: () => {
      model += 1
      throw new Error("artifact freshness must not construct a provider model")
    },
    health: async () => {
      health += 1
      return { kind: "healthy" }
    }
  }
  return {
    app: createApp({ persistence, providerRegistry: new ProviderRegistry([provider]) }),
    documentVersionId,
    providerCalls: () => ({ model, health })
  }
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

describe("artifact provenance route", () => {
  test("returns immutable current-generation provenance without provider invocation", async () => {
    // Given
    const harness = setup()
    const token = await csrf(harness.app)
    const headers = {
      "content-type": "application/json",
      cookie: token.cookie,
      "x-csrf-token": token.token
    }
    const seriesId = crypto.randomUUID()
    const revisionId = crypto.randomUUID()

    // When
    const settings = await harness.app.request(localUrl("/api/settings/providers/fake"), {
      method: "PUT",
      headers,
      body: JSON.stringify({
        selectedModel: "fake-model",
        enabled: true,
        capabilities: { generation: true }
      })
    })
    const series = await harness.app.request(localUrl("/api/artifacts/series"), {
      method: "POST",
      headers,
      body: JSON.stringify({ id: seriesId, kind: "cover_letter" })
    })
    const revision = await harness.app.request(
      localUrl(`/api/artifacts/series/${seriesId}/revisions`),
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: revisionId,
          content: { text: "draft" },
          inputs: [{ kind: "document_version", documentVersionId: harness.documentVersionId }],
          providerId: "fake",
          promptTemplateId: "cover-letter",
          providerRunId: null,
          disclosureId: null
        })
      }
    )
    const provenance = await harness.app.request(
      localUrl(`/api/artifacts/revisions/${revisionId}/provenance`)
    )

    // Then
    expect(settings.status).toBe(200)
    expect(series.status).toBe(201)
    expect(revision.status).toBe(201)
    expect(await provenance.json()).toEqual(
      expect.objectContaining({
        id: revisionId,
        providerId: "fake",
        providerMode: "test",
        providerModel: "fake-model",
        promptTemplateId: "cover-letter",
        promptTemplateRevision: "cover-letter@1",
        staleReasons: []
      })
    )
    expect(harness.providerCalls()).toEqual({ model: 0, health: 0 })
  })
})
