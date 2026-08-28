import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ProviderIdSchema } from "../src/agents"
import { CurrentGenerationContextResolver } from "../src/artifacts/current-generation-context"
import { DraftArtifactRepository } from "../src/artifacts/draft-artifact-repository"
import { DraftArtifactService } from "../src/artifacts/draft-artifact-service"
import { createPersistence, type Persistence } from "../src/db"
import { defaultPromptTemplateRevisionRegistry } from "../src/prompts/prompt-template-revisions"

const directories: string[] = []
const handles: Persistence[] = []
const timestamp = "2026-08-26T12:00:00.000Z"
const hash = (character: string): string => character.repeat(64)
const setup = (): {
  readonly persistence: Persistence
  readonly documentId: string
  readonly documentVersionId: string
  readonly service: DraftArtifactService
} => {
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-artifact-source-"))
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
  const service = new DraftArtifactService(
    new DraftArtifactRepository(persistence.database),
    new CurrentGenerationContextResolver({
      providers: {
        get: () => ({
          descriptor: {
            id: ProviderIdSchema.parse("fake"),
            mode: "test",
            model: { id: "fake-model", displayName: "Fake", maxOutputTokens: 128 },
            capabilities: { generation: true, structuredOutput: true, citedResearch: false }
          },
          enabled: true
        })
      },
      settings: {
        get: () => ({
          selectedModel: "fake-model",
          enabled: true,
          capabilities: { generation: true }
        })
      },
      prompts: defaultPromptTemplateRevisionRegistry
    }),
    persistence.database
  )
  return { persistence, documentId, documentVersionId, service }
}
const createRevision = (harness: ReturnType<typeof setup>): string => {
  const series = harness.service.createSeries({ id: crypto.randomUUID(), kind: "cover_letter" })
  return harness.service.createRevision({
    id: crypto.randomUUID(),
    seriesId: series.id,
    content: { text: "draft" },
    inputs: [{ kind: "document_version", documentVersionId: harness.documentVersionId }],
    providerId: "fake",
    promptTemplateId: "cover-letter",
    providerRunId: null,
    disclosureId: null
  }).id
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe("draft artifact source freshness", () => {
  test("reports changed and deleted sources while preserving immutable provenance", () => {
    // Given
    const harness = setup()
    const revisionId = createRevision(harness)
    harness.persistence.database.run(
      "INSERT INTO blobs (sha256,byte_size,media_type,created_at) VALUES (?,?,?,?)",
      [hash("b"), 1, "text/plain", timestamp]
    )

    // When / Then
    harness.persistence.database.run("UPDATE document_versions SET blob_hash=? WHERE id=?", [
      hash("b"),
      harness.documentVersionId
    ])
    expect(harness.service.getProvenance(revisionId).staleReasons).toEqual([
      "source_content_changed"
    ])
    harness.persistence.database.run("UPDATE documents SET state='deleted' WHERE id=?", [
      harness.documentId
    ])
    expect(harness.service.getProvenance(revisionId).staleReasons).toEqual(["source_unavailable"])
    expect(harness.service.getRevision(revisionId)).toEqual(
      expect.objectContaining({ id: revisionId, content: { text: "draft" } })
    )
  })
})
