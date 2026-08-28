import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ProviderRegistry, type ProviderRegistration } from "../src/agents"
import { createPersistence, type Persistence } from "../src/db"
import { DisclosureError, DisclosureService } from "../src/disclosures/service"

const directories: string[] = []
const handles: Persistence[] = []
const hash = (character: string): string => character.repeat(64)
const timestamp = "2026-08-26T12:00:00.000Z"

const setup = (): { readonly persistence: Persistence; readonly service: DisclosureService } => {
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-disclosures-"))
  directories.push(directory)
  const persistence = createPersistence({ dataDirectory: directory })
  handles.push(persistence)
  const provider: ProviderRegistration = {
    descriptor: {
      id: "fake",
      mode: "test",
      model: { id: "fake-model", displayName: "Fake", maxOutputTokens: 128 },
      capabilities: { generation: true, structuredOutput: true, citedResearch: false }
    },
    enabled: true,
    createModel: () => {
      throw new Error("preview must not construct a model")
    },
    health: async () => {
      throw new Error("preview must not call provider health")
    }
  }
  persistence.repositories.operations.upsertProviderSettings({
    providerKind: "fake",
    selectedModel: "fake-model",
    enabled: true,
    capabilities: { generation: true },
    updatedAt: timestamp
  })
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
  return {
    persistence,
    service: new DisclosureService({
      database: persistence.database,
      providers: new ProviderRegistry([provider]),
      secret: new Uint8Array(32).fill(3),
      now: () => new Date(timestamp)
    })
  }
}

const request = (documentVersionId: string) => ({
  providerId: "fake",
  mode: "test" as const,
  model: "fake-model",
  action: "generate",
  capability: "generation" as const,
  research: false,
  requestHash: hash("b"),
  inputs: [{ kind: "document_version" as const, documentVersionId }]
})

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe("disclosure preflight and confirmation", () => {
  test("returns a signed manifest without persisting or contacting a provider", () => {
    // Given
    const harness = setup()
    const version = harness.persistence.database
      .query<{ readonly id: string }, []>("SELECT id FROM document_versions")
      .get()?.id
    if (version === undefined) throw new Error("document fixture missing")

    // When
    const preview = harness.service.preview(request(version))

    // Then
    expect(preview.manifest.destination).toBe("fake")
    expect(preview.manifest.inputs).toEqual([
      expect.objectContaining({ type: "document_version", hash: hash("a"), label: "Resume" })
    ])
    expect(preview.authorizationToken).not.toContain("Resume")
    expect(harness.service.list()).toEqual([])
  })

  test("rejects a confirmation after the selected document current version changes", () => {
    // Given
    const harness = setup()
    const version = harness.persistence.database
      .query<{ readonly id: string }, []>("SELECT id FROM document_versions")
      .get()?.id
    if (version === undefined) throw new Error("document fixture missing")
    const preview = harness.service.preview(request(version))
    const document = harness.persistence.database
      .query<{ readonly id: string }, []>("SELECT id FROM documents")
      .get()?.id
    if (document === undefined) throw new Error("document fixture missing")
    const changed = crypto.randomUUID()
    harness.persistence.database.run(
      "INSERT INTO blobs (sha256,byte_size,media_type,created_at) VALUES (?,?,?,?)",
      [hash("c"), 1, "text/plain", timestamp]
    )
    harness.persistence.database.run(
      "INSERT INTO document_versions (id,document_id,version_number,blob_hash,created_at) VALUES (?,?,?,?,?)",
      [changed, document, 2, hash("c"), timestamp]
    )
    harness.persistence.database.run("UPDATE documents SET current_version_id=? WHERE id=?", [
      changed,
      document
    ])

    // When / Then
    expect(() =>
      harness.service.confirm({ authorizationToken: preview.authorizationToken })
    ).toThrow(DisclosureError)
    expect(harness.service.list()).toEqual([])
  })

  test("accepts one valid confirmation and consumes it exactly once for its matching run", () => {
    // Given
    const harness = setup()
    const version = harness.persistence.database
      .query<{ readonly id: string }, []>("SELECT id FROM document_versions")
      .get()?.id
    if (version === undefined) throw new Error("document fixture missing")
    const preview = harness.service.preview(request(version))
    const confirmed = harness.service.confirm({ authorizationToken: preview.authorizationToken })

    // When
    const consumed = harness.service.consume({
      ...request(version),
      disclosureId: confirmed.id,
      runId: crypto.randomUUID()
    })

    // Then
    expect(consumed.id).toBe(confirmed.id)
    expect(() =>
      harness.service.consume({
        ...request(version),
        disclosureId: confirmed.id,
        runId: crypto.randomUUID()
      })
    ).toThrow(DisclosureError)
  })

  test("rejects a confirmation whose research permission or expiry was changed directly in storage", () => {
    // Given
    const harness = setup()
    const version = harness.persistence.database
      .query<{ readonly id: string }, []>("SELECT id FROM document_versions")
      .get()?.id
    if (version === undefined) throw new Error("document fixture missing")
    const confirmed = harness.service.confirm({
      authorizationToken: harness.service.preview(request(version)).authorizationToken
    })

    // When / Then
    expect(() =>
      harness.persistence.database.run(
        "UPDATE disclosure_confirmations SET research_enabled=1,expires_at=? WHERE id=?",
        ["2027-08-26T12:00:00.000Z", confirmed.id]
      )
    ).toThrow("disclosure confirmation is immutable")
  })
})
