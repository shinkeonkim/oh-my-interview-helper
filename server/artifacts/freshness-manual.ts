import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ProviderIdSchema, ProviderRegistry, type ProviderRegistration } from "../src/agents"
import { CurrentGenerationContextResolver } from "../src/artifacts/current-generation-context"
import { DraftArtifactRepository } from "../src/artifacts/draft-artifact-repository"
import { DraftArtifactService } from "../src/artifacts/draft-artifact-service"
import { createPersistence } from "../src/db"
import { ProviderKindSchema } from "../src/db/operations-repositories"
import {
  defaultPromptTemplateRevisionRegistry,
  PromptTemplateRevisionRegistry
} from "../src/prompts/prompt-template-revisions"

const timestamp = "2026-08-26T12:00:00.000Z"
const hash = (character: string): string => character.repeat(64)
const dataDirectory = mkdtempSync(join(tmpdir(), "interview-helper-freshness-manual-"))
const evidenceDirectory = ".omo/evidence/task-7-interview-helper/manual"
const evidencePath = join(evidenceDirectory, "freshness-result.json")
const persistence = createPersistence({ dataDirectory })
const provider: ProviderRegistration = {
  descriptor: {
    id: ProviderIdSchema.parse("fake"),
    mode: "test",
    model: { id: "fake-model", displayName: "Fake", maxOutputTokens: 128 },
    capabilities: { generation: true, structuredOutput: true, citedResearch: false }
  },
  enabled: true,
  createModel: () => {
    throw new Error("freshness must not construct a model")
  },
  health: async () => ({ kind: "healthy" })
}
const providers = new ProviderRegistry([provider])
let prompts = defaultPromptTemplateRevisionRegistry
const service = (): DraftArtifactService =>
  new DraftArtifactService(
    new DraftArtifactRepository(persistence.database),
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
      prompts
    }),
    persistence.database
  )

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
persistence.repositories.operations.upsertProviderSettings({
  providerKind: "fake",
  selectedModel: "fake-model",
  enabled: true,
  capabilities: { generation: true },
  updatedAt: timestamp
})
const series = service().createSeries({ id: crypto.randomUUID(), kind: "cover_letter" })
const revision = service().createRevision({
  id: crypto.randomUUID(),
  seriesId: series.id,
  content: { text: "draft" },
  inputs: [{ kind: "document_version", documentVersionId }],
  providerId: "fake",
  promptTemplateId: "cover-letter",
  providerRunId: null,
  disclosureId: null
})
const matching = service().getProvenance(revision.id).staleReasons
persistence.repositories.operations.upsertProviderSettings({
  providerKind: "fake",
  selectedModel: "fake-model",
  enabled: false,
  capabilities: { generation: true },
  updatedAt: timestamp
})
const disabled = service().getProvenance(revision.id).staleReasons
persistence.repositories.operations.upsertProviderSettings({
  providerKind: "fake",
  selectedModel: "fake-model",
  enabled: true,
  capabilities: { generation: true },
  updatedAt: timestamp
})
prompts = new PromptTemplateRevisionRegistry([{ id: "cover-letter", revision: "cover-letter@2" }])
const promptChanged = service().getProvenance(revision.id).staleReasons
let rawProvenanceMutationBlocked = false
try {
  persistence.database.run("UPDATE draft_artifact_revisions SET provider_model=? WHERE id=?", [
    "forged-model",
    revision.id
  ])
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("draft artifact revision is immutable"))
    throw error
  rawProvenanceMutationBlocked = true
}
service().archive(series.id)
let archivedCreationBlocked = false
try {
  service().createRevision({
    id: crypto.randomUUID(),
    seriesId: series.id,
    content: { text: "draft" },
    inputs: [{ kind: "document_version", documentVersionId }],
    providerId: "fake",
    promptTemplateId: "cover-letter",
    providerRunId: null,
    disclosureId: null
  })
} catch (error) {
  if (!(error instanceof Error) || error.message !== "ARTIFACT_SERIES_UNAVAILABLE") throw error
  archivedCreationBlocked = true
}
const result = {
  archivedCreationBlocked,
  cleanup: { ports: [], temporaryRootRemoved: true },
  matching,
  promptChanged,
  providerDisabled: disabled,
  rawProvenanceMutationBlocked
}
persistence.close()
rmSync(dataDirectory, { force: true, recursive: true })
mkdirSync(evidenceDirectory, { recursive: true })
writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 })
