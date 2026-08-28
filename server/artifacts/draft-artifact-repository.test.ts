import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ProviderRegistry, type ProviderRegistration } from "../src/agents"
import { CurrentGenerationContextResolver } from "../src/artifacts/current-generation-context"
import { defaultPromptTemplateRevisionRegistry } from "../src/prompts/prompt-template-revisions"
import { DraftArtifactRepository } from "../src/artifacts/draft-artifact-repository"
import { DraftArtifactService } from "../src/artifacts/draft-artifact-service"
import { createPersistence, type Persistence } from "../src/db"
import { ProviderKindSchema } from "../src/db/operations-repositories"

const directories: string[] = []
const handles: Persistence[] = []
const timestamp = "2026-08-26T12:00:00.000Z"
const hash = (character: string): string => character.repeat(64)
const setup = (): {
  readonly persistence: Persistence
  readonly service: DraftArtifactService
} => {
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-draft-artifact-"))
  directories.push(directory)
  const persistence = createPersistence({ dataDirectory: directory })
  handles.push(persistence)
  const documentId = crypto.randomUUID()
  const versionId = crypto.randomUUID()
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
    [versionId, documentId, 1, hash("a"), timestamp]
  )
  persistence.database.run("UPDATE documents SET current_version_id=? WHERE id=?", [
    versionId,
    documentId
  ])
  const provider = {
    descriptor: {
      id: "fake",
      mode: "test",
      model: { id: "fake-model", displayName: "Fake", maxOutputTokens: 128 },
      capabilities: { generation: true, structuredOutput: true, citedResearch: false }
    },
    enabled: true,
    createModel: () => {
      throw new Error("freshness must not construct a model")
    },
    health: async () => {
      throw new Error("freshness must not probe provider health")
    }
  } satisfies ProviderRegistration
  persistence.repositories.operations.upsertProviderSettings({
    providerKind: "fake",
    selectedModel: "fake-model",
    enabled: true,
    capabilities: { generation: true },
    updatedAt: timestamp
  })
  const repository = new DraftArtifactRepository(persistence.database)
  const providers = new ProviderRegistry([provider])
  const service = new DraftArtifactService(
    repository,
    new CurrentGenerationContextResolver({
      providers: {
        get: (providerId) => {
          const registration = providers.get(providerId)
          return registration === null
            ? null
            : { descriptor: registration.descriptor, enabled: registration.enabled }
        }
      },
      settings: {
        get: (providerId) =>
          persistence.repositories.operations.getProviderSettings(
            ProviderKindSchema.parse(providerId)
          )
      },
      prompts: defaultPromptTemplateRevisionRegistry
    }),
    persistence.database
  )
  return { persistence, service }
}
const versionId = (persistence: Persistence): string => {
  const id = persistence.database
    .query<{ readonly id: string }, []>("SELECT id FROM document_versions")
    .get()?.id
  if (id === undefined) throw new Error("document fixture missing")
  return id
}
const createRevision = (
  service: DraftArtifactService,
  seriesId: string,
  documentVersionId: string
) =>
  service.createRevision({
    id: crypto.randomUUID(),
    seriesId,
    content: { text: "draft" },
    inputs: [{ kind: "document_version", documentVersionId }],
    providerId: "fake",
    promptTemplateId: "cover-letter",
    providerRunId: null,
    disclosureId: null
  })

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe("immutable draft artifact revisions", () => {
  test("records resolver-owned provider and prompt provenance", () => {
    // Given
    const harness = setup()
    const series = harness.service.createSeries({ id: crypto.randomUUID(), kind: "cover_letter" })

    // When
    const revision = createRevision(harness.service, series.id, versionId(harness.persistence))

    // Then
    expect(revision).toEqual(
      expect.objectContaining({
        providerId: "fake",
        providerMode: "test",
        providerModel: "fake-model",
        promptTemplateId: "cover-letter",
        promptTemplateRevision: "cover-letter@1"
      })
    )
    expect(() =>
      harness.persistence.database.run(
        "UPDATE draft_artifact_revisions SET prompt_template_id=? WHERE id=?",
        ["forged", revision.id]
      )
    ).toThrow("draft artifact revision is immutable")
  })

  test("keeps old provenance inspectable when the source current version changes", () => {
    // Given
    const harness = setup()
    const version = versionId(harness.persistence)
    const series = harness.service.createSeries({ id: crypto.randomUUID(), kind: "cover_letter" })
    const revision = createRevision(harness.service, series.id, version)
    const document = harness.persistence.database
      .query<{ readonly id: string }, []>("SELECT id FROM documents")
      .get()?.id
    if (document === undefined) throw new Error("document fixture missing")
    const changed = crypto.randomUUID()
    harness.persistence.database.run(
      "INSERT INTO blobs (sha256,byte_size,media_type,created_at) VALUES (?,?,?,?)",
      [hash("b"), 1, "text/plain", timestamp]
    )
    harness.persistence.database.run(
      "INSERT INTO document_versions (id,document_id,version_number,blob_hash,created_at) VALUES (?,?,?,?,?)",
      [changed, document, 2, hash("b"), timestamp]
    )
    harness.persistence.database.run("UPDATE documents SET current_version_id=? WHERE id=?", [
      changed,
      document
    ])

    // When
    const provenance = harness.service.getProvenance(revision.id)

    // Then
    expect(provenance.staleReasons).toEqual(["source_current_version_changed"])
    expect(harness.service.getRevision(revision.id)).toEqual(
      expect.objectContaining({ content: { text: "draft" } })
    )
  })

  test("rejects archived and deleted series, raw forged hashes, and caller-owned prompt revisions", () => {
    // Given
    const harness = setup()
    const series = harness.service.createSeries({ id: crypto.randomUUID(), kind: "cover_letter" })
    harness.service.archive(series.id)

    // When / Then
    expect(() =>
      createRevision(harness.service, series.id, versionId(harness.persistence))
    ).toThrow("ARTIFACT_SERIES_UNAVAILABLE")
    const deleted = harness.service.createSeries({ id: crypto.randomUUID(), kind: "cover_letter" })
    harness.service.logicalDelete(deleted.id)
    expect(() =>
      createRevision(harness.service, deleted.id, versionId(harness.persistence))
    ).toThrow("ARTIFACT_SERIES_UNAVAILABLE")
    expect(() =>
      harness.service.createRevision({
        id: crypto.randomUUID(),
        seriesId: crypto.randomUUID(),
        content: { text: "forged" },
        inputs: [{ kind: "document_version", documentVersionId: versionId(harness.persistence) }],
        providerId: "fake",
        promptTemplateId: "cover-letter",
        promptTemplateRevision: "forged@999",
        providerRunId: null,
        disclosureId: null
      })
    ).toThrow()
  })

  test("blocks every raw provider and prompt provenance mutation", () => {
    // Given
    const harness = setup()
    const series = harness.service.createSeries({ id: crypto.randomUUID(), kind: "cover_letter" })
    const revision = createRevision(harness.service, series.id, versionId(harness.persistence))

    // When / Then
    for (const [column, value] of [
      ["provider_run_id", crypto.randomUUID()],
      ["provider_id", "forged"],
      ["provider_mode", "api"],
      ["provider_model", "forged-model"],
      ["provider_capability_revision", hash("b")],
      ["prompt_template_id", "forged-template"],
      ["prompt_template_revision", "forged@1"]
    ])
      expect(() =>
        harness.persistence.database.run(
          `UPDATE draft_artifact_revisions SET ${column}=? WHERE id=?`,
          [value, revision.id]
        )
      ).toThrow("draft artifact revision is immutable")
  })

  test("marks a deleted provider setting unavailable and clears it after restoration", () => {
    // Given
    const harness = setup()
    const series = harness.service.createSeries({ id: crypto.randomUUID(), kind: "cover_letter" })
    const revision = createRevision(harness.service, series.id, versionId(harness.persistence))

    // When / Then
    harness.persistence.database.run("DELETE FROM provider_settings WHERE provider_kind=?", [
      "fake"
    ])
    expect(harness.service.getProvenance(revision.id).staleReasons).toEqual([
      "provider_unavailable"
    ])
    harness.persistence.repositories.operations.upsertProviderSettings({
      providerKind: "fake",
      selectedModel: "fake-model",
      enabled: true,
      capabilities: { generation: true },
      updatedAt: timestamp
    })
    expect(harness.service.getProvenance(revision.id).staleReasons).toEqual([])
  })
})
