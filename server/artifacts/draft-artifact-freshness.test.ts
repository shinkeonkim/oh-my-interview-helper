import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ProviderDescriptor } from "../src/agents/contracts"
import {
  CurrentGenerationContextResolver,
  type CurrentProviderSettings
} from "../src/artifacts/current-generation-context"
import { DraftArtifactRepository } from "../src/artifacts/draft-artifact-repository"
import { DraftArtifactService } from "../src/artifacts/draft-artifact-service"
import { createPersistence, type Persistence } from "../src/db"
import {
  defaultPromptTemplateRevisionRegistry,
  PromptTemplateRevisionRegistry
} from "../src/prompts/prompt-template-revisions"

const directories: string[] = []
const handles: Persistence[] = []
const timestamp = "2026-08-26T12:00:00.000Z"
const hash = (character: string): string => character.repeat(64)
type FreshnessState = {
  descriptor: ProviderDescriptor
  providerEnabled: boolean
  settings: CurrentProviderSettings | null
  prompts: PromptTemplateRevisionRegistry
}
const setup = (): {
  readonly persistence: Persistence
  readonly documentVersionId: string
  readonly state: FreshnessState
  readonly service: () => DraftArtifactService
} => {
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-freshness-"))
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
  const state: FreshnessState = {
    descriptor: {
      id: "fake",
      mode: "test",
      model: { id: "fake-model", displayName: "Fake", maxOutputTokens: 128 },
      capabilities: { generation: true, structuredOutput: true, citedResearch: false }
    },
    providerEnabled: true,
    settings: { selectedModel: "fake-model", enabled: true, capabilities: { generation: true } },
    prompts: defaultPromptTemplateRevisionRegistry
  }
  const service = (): DraftArtifactService =>
    new DraftArtifactService(
      new DraftArtifactRepository(persistence.database),
      new CurrentGenerationContextResolver({
        providers: {
          get: () => ({ descriptor: state.descriptor, enabled: state.providerEnabled })
        },
        settings: { get: () => state.settings },
        prompts: state.prompts
      }),
      persistence.database
    )
  return { persistence, documentVersionId, state, service }
}
const createRevision = (harness: ReturnType<typeof setup>): string => {
  const series = harness.service().createSeries({ id: crypto.randomUUID(), kind: "cover_letter" })
  return harness.service().createRevision({
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

describe("draft artifact provider and prompt freshness", () => {
  test("reports provider settings changes and clears reasons when matching state is restored", () => {
    // Given
    const harness = setup()
    const revisionId = createRevision(harness)

    // When / Then
    expect(harness.service().getProvenance(revisionId).staleReasons).toEqual([])
    harness.state.settings = {
      selectedModel: "fake-model",
      enabled: false,
      capabilities: { generation: true }
    }
    expect(harness.service().getProvenance(revisionId).staleReasons).toEqual(["provider_disabled"])
    harness.state.settings = null
    expect(harness.service().getProvenance(revisionId).staleReasons).toEqual([
      "provider_unavailable"
    ])
    harness.state.settings = {
      selectedModel: "other-model",
      enabled: true,
      capabilities: { generation: true }
    }
    expect(harness.service().getProvenance(revisionId).staleReasons).toEqual(["provider_changed"])
    harness.state.settings = {
      selectedModel: "fake-model",
      enabled: true,
      capabilities: { generation: true }
    }
    expect(harness.service().getProvenance(revisionId).staleReasons).toEqual([])
  })

  test("reports descriptor and prompt registry changes without invoking a provider", () => {
    // Given
    const harness = setup()
    const revisionId = createRevision(harness)

    // When / Then
    harness.state.descriptor = {
      ...harness.state.descriptor,
      capabilities: { generation: false, structuredOutput: true, citedResearch: false }
    }
    expect(harness.service().getProvenance(revisionId).staleReasons).toEqual(["provider_changed"])
    harness.state.descriptor = {
      ...harness.state.descriptor,
      capabilities: { generation: true, structuredOutput: true, citedResearch: false },
      model: { id: "new-model", displayName: "New", maxOutputTokens: 128 }
    }
    expect(harness.service().getProvenance(revisionId).staleReasons).toEqual([
      "model_changed",
      "provider_changed"
    ])
    harness.state.descriptor = {
      ...harness.state.descriptor,
      capabilities: { generation: true, structuredOutput: true, citedResearch: false },
      model: { id: "fake-model", displayName: "Fake", maxOutputTokens: 128 },
      mode: "api"
    }
    expect(harness.service().getProvenance(revisionId).staleReasons).toEqual(["mode_changed"])
    harness.state.descriptor = { ...harness.state.descriptor, mode: "test" }
    harness.state.prompts = new PromptTemplateRevisionRegistry([
      { id: "cover-letter", revision: "cover-letter@2" }
    ])
    expect(harness.service().getProvenance(revisionId).staleReasons).toEqual(["prompt_changed"])
    harness.state.prompts = new PromptTemplateRevisionRegistry([])
    expect(harness.service().getProvenance(revisionId).staleReasons).toEqual(["prompt_missing"])
    harness.state.prompts = defaultPromptTemplateRevisionRegistry
    expect(harness.service().getProvenance(revisionId).staleReasons).toEqual([])
  })
})
