import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPersistence, type Persistence } from "../src/db/index"

const temporaryDirectories: string[] = []
const timestamp = "2026-08-26T12:00:00.000Z"

const createDataDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-repositories-integration-"))
  temporaryDirectories.push(directory)
  return directory
}

const createAllDomainRecords = (persistence: Persistence, blobHash: string) => {
  const { documents, domain, operations, providerArtifacts, researchConversations } =
    persistence.repositories
  const document = documents.create({
    id: crypto.randomUUID(),
    kind: "resume",
    title: "Interview resume"
  })
  const documentVersionId = crypto.randomUUID()
  documents.addVersion({ id: documentVersionId, documentId: document.id, blobHash })
  const versionedDocument = documents.get(document.id)
  if (versionedDocument === null) throw new Error("document version was not persisted")
  const jobPost = domain.createJobPost({
    id: crypto.randomUUID(),
    title: "Senior Engineer",
    companyName: "Example"
  })
  const jobPostVersion = domain.addJobPostVersion({
    id: crypto.randomUUID(),
    jobPostId: jobPost.id,
    sourceKind: "manual",
    content: { location: "Seoul" }
  })
  const application = domain.createApplication({
    id: crypto.randomUUID(),
    jobPostId: jobPost.id,
    idempotencyKey: crypto.randomUUID()
  })
  const applicationEvent = domain.appendApplicationEvent({
    id: crypto.randomUUID(),
    applicationId: application.id,
    kind: "created",
    payload: { source: "manual" }
  })
  const providerRun = providerArtifacts.createProviderRun({
    id: crypto.randomUUID(),
    providerKind: "openai",
    mode: "chat",
    model: "gpt-5.6",
    requestHash: "a".repeat(64),
    status: "succeeded",
    usage: { inputTokens: 120, outputTokens: 48 },
    cost: { currency: "USD", microunits: 900 },
    error: null,
    completedAt: timestamp
  })
  const artifact = providerArtifacts.createArtifact({
    id: crypto.randomUUID(),
    kind: "cover_letter",
    status: "draft",
    providerRunId: providerRun.id,
    bodyBlobHash: blobHash,
    version: 1,
    content: { text: "Evidence-led introduction" }
  })
  const documentInput = providerArtifacts.createArtifactInput({
    artifactId: artifact.id,
    source: { kind: "document_version", documentVersionId }
  })
  const jobPostInput = providerArtifacts.createArtifactInput({
    artifactId: artifact.id,
    source: { kind: "job_post_version", jobPostVersionId: jobPostVersion.id }
  })
  const researchRecord = researchConversations.createResearchRecord({
    id: crypto.randomUUID(),
    kind: "company",
    scope: { kind: "job_post", jobPostId: jobPost.id },
    contentBlobHash: blobHash
  })
  const researchSource = researchConversations.createResearchSource({
    id: crypto.randomUUID(),
    researchRecordId: researchRecord.id,
    canonicalUrl: "https://example.com/company",
    title: "Example company",
    contentHash: blobHash,
    excerpt: "Public information",
    status: "available",
    bodyBlobHash: blobHash,
    retrievedAt: timestamp
  })
  const researchInput = providerArtifacts.createArtifactInput({
    artifactId: artifact.id,
    source: { kind: "research_record", researchRecordId: researchRecord.id }
  })
  const conversation = researchConversations.createConversation({
    id: crypto.randomUUID(),
    applicationId: application.id,
    title: "Interview practice"
  })
  const message = researchConversations.appendMessage({
    id: crypto.randomUUID(),
    conversationId: conversation.id,
    role: "assistant",
    content: { text: "Tell me about yourself." },
    bodyBlobHash: blobHash,
    providerRunId: providerRun.id
  })
  const job = operations.createJob({
    id: crypto.randomUUID(),
    kind: "interview_brief",
    state: "leased",
    idempotencyKey: crypto.randomUUID(),
    payload: { applicationId: application.id },
    leaseOwner: "runner-a",
    leaseExpiresAt: "2026-08-26T12:05:00.000Z",
    errorCode: null,
    errorMessage: null
  })
  const jobEvent = operations.appendJobEvent({
    id: crypto.randomUUID(),
    jobId: job.id,
    kind: "leased",
    payload: { owner: "runner-a" }
  })
  const settings = operations.upsertProviderSettings({
    providerKind: "openai",
    selectedModel: "gpt-5.6",
    enabled: true,
    capabilities: { structuredOutput: true },
    updatedAt: timestamp
  })
  const disclosure = operations.recordDisclosure({
    id: crypto.randomUUID(),
    requestHash: "b".repeat(64),
    providerKind: settings.providerKind,
    destination: "https://provider.example/disclose",
    action: "generate_cover_letter",
    actionAt: timestamp,
    selectedInputHashes: [blobHash]
  })
  const runner = operations.upsertRunnerRegistration({
    id: crypto.randomUUID(),
    runnerName: "runner-a",
    tokenHash: "c".repeat(64),
    capabilities: { concurrency: 1 },
    status: "active",
    registeredAt: timestamp,
    lastSeenAt: timestamp,
    revokedAt: null
  })

  return {
    application,
    applicationEvent,
    artifact,
    conversation,
    document: versionedDocument,
    documentInput,
    disclosure,
    job,
    jobEvent,
    jobPost,
    jobPostInput,
    jobPostVersion,
    message,
    providerRun,
    researchInput,
    researchRecord,
    researchSource,
    runner,
    settings
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { force: true, recursive: true })
})

test("composes every repository family atomically and reopens typed records", async () => {
  // Given
  const dataDirectory = createDataDirectory()
  const persistence = createPersistence({ dataDirectory })
  const blob = await persistence.blobs.put(new Blob(["resume bytes"]), "text/plain")
  persistence.repositories.blobs.register(blob)
  let rolledBack: ReturnType<typeof createAllDomainRecords> | null = null

  // When
  expect(() =>
    persistence.repositories.transaction(() => {
      rolledBack = createAllDomainRecords(persistence, blob.sha256)
      throw new Error("late failure")
    })
  ).toThrow("late failure")
  const persisted = persistence.repositories.transaction(() =>
    createAllDomainRecords(persistence, blob.sha256)
  )
  persistence.close()
  const reopened = createPersistence({ dataDirectory })

  // Then
  if (rolledBack === null) throw new Error("rollback fixture was not created")
  expect(reopened.repositories.documents.get(rolledBack.document.id)).toBeNull()
  expect(reopened.repositories.domain.getJobPost(rolledBack.jobPost.id)).toBeNull()
  expect(reopened.repositories.providerArtifacts.getArtifact(rolledBack.artifact.id)).toBeNull()
  expect(
    reopened.repositories.researchConversations.getResearchRecord(rolledBack.researchRecord.id)
  ).toBeNull()
  expect(reopened.repositories.operations.getJob(rolledBack.job.id)).toBeNull()
  expect(reopened.repositories.documents.get(persisted.document.id)).toEqual(persisted.document)
  expect(reopened.repositories.domain.listJobPostVersions(persisted.jobPost.id)).toEqual([
    persisted.jobPostVersion
  ])
  expect(reopened.repositories.domain.listApplicationEvents(persisted.application.id)).toEqual([
    persisted.applicationEvent
  ])
  expect(reopened.repositories.providerArtifacts.getProviderRun(persisted.providerRun.id)).toEqual(
    persisted.providerRun
  )
  expect(reopened.repositories.providerArtifacts.listArtifactInputs(persisted.artifact.id)).toEqual(
    [persisted.documentInput, persisted.jobPostInput, persisted.researchInput]
  )
  expect(
    reopened.repositories.researchConversations.getResearchSource(persisted.researchSource.id)
  ).toEqual(persisted.researchSource)
  expect(
    reopened.repositories.researchConversations.listMessages(persisted.conversation.id)
  ).toEqual([persisted.message])
  expect(reopened.repositories.operations.listJobEvents(persisted.job.id)).toEqual([
    persisted.jobEvent
  ])
  expect(
    reopened.repositories.operations.getProviderSettings(persisted.settings.providerKind)
  ).toEqual(persisted.settings)
  expect(reopened.repositories.operations.getDisclosure(persisted.disclosure.id)).toEqual(
    persisted.disclosure
  )
  expect(
    reopened.repositories.operations.getRunnerRegistration(persisted.runner.runnerName)
  ).toEqual(persisted.runner)
  reopened.close()
})
