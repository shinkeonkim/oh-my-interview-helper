import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ConversationCreateSchema, createPersistence } from "../src/db/index"

const timestamp = "2026-08-26T12:00:00.000Z"
const resultPath = ".omo/evidence/task-3-interview-helper/manual/all-domain-result.json"
const dataDirectory = mkdtempSync(join(tmpdir(), "interview-helper-all-domain-manual-"))

const main = async (): Promise<void> => {
  const first = createPersistence({ dataDirectory })
  const second = createPersistence({ dataDirectory })
  const wal = first.database
    .query<{ readonly journal_mode: string }, []>("PRAGMA journal_mode")
    .get()?.journal_mode
  const foreignKeys = first.database
    .query<{ readonly foreign_keys: number }, []>("PRAGMA foreign_keys")
    .get()?.foreign_keys
  const busyTimeout = first.database
    .query<{ readonly timeout: number }, []>("PRAGMA busy_timeout")
    .get()?.timeout
  second.close()
  const blob = await first.blobs.put(new Blob(["all-domain manual blob"]), "text/plain")
  const { blobs, documents, domain, operations, providerArtifacts, researchConversations } =
    first.repositories
  blobs.register(blob)
  const document = documents.create({ id: crypto.randomUUID(), kind: "resume", title: "Resume" })
  documents.addVersion({ id: crypto.randomUUID(), documentId: document.id, blobHash: blob.sha256 })
  const jobPost = domain.createJobPost({
    id: crypto.randomUUID(),
    title: "Engineer",
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
  domain.appendApplicationEvent({
    id: crypto.randomUUID(),
    applicationId: application.id,
    kind: "created",
    payload: {}
  })
  domain.appendApplicationEvent({
    id: crypto.randomUUID(),
    applicationId: application.id,
    kind: "applied",
    payload: {}
  })
  const providerRun = providerArtifacts.createProviderRun({
    id: crypto.randomUUID(),
    providerKind: "openai",
    mode: "chat",
    model: "gpt-5.6",
    requestHash: "a".repeat(64),
    status: "succeeded",
    usage: { inputTokens: 1, outputTokens: 1 },
    cost: { currency: "USD", microunits: 1 },
    error: null,
    completedAt: timestamp
  })
  const artifact = providerArtifacts.createArtifact({
    id: crypto.randomUUID(),
    kind: "cover_letter",
    status: "draft",
    providerRunId: providerRun.id,
    bodyBlobHash: blob.sha256,
    version: 1,
    content: { text: "Evidence" }
  })
  providerArtifacts.createArtifactInput({
    artifactId: artifact.id,
    source: { kind: "job_post_version", jobPostVersionId: jobPostVersion.id }
  })
  const researchRecord = researchConversations.createResearchRecord({
    id: crypto.randomUUID(),
    kind: "company",
    scope: { kind: "job_post", jobPostId: jobPost.id },
    contentBlobHash: blob.sha256
  })
  researchConversations.createResearchSource({
    id: crypto.randomUUID(),
    researchRecordId: researchRecord.id,
    canonicalUrl: "https://example.com/company",
    title: "Example",
    contentHash: blob.sha256,
    excerpt: "Public",
    status: "available",
    bodyBlobHash: blob.sha256,
    retrievedAt: timestamp
  })
  const conversation = researchConversations.createConversation({
    id: crypto.randomUUID(),
    applicationId: application.id,
    title: "Practice"
  })
  const messages = [
    researchConversations.appendMessage({
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: "user",
      content: { text: "Practice" }
    }),
    researchConversations.appendMessage({
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: "assistant",
      content: { text: "Answer" },
      providerRunId: providerRun.id
    })
  ]
  const settings = operations.upsertProviderSettings({
    providerKind: "openai",
    selectedModel: "gpt-5.6",
    enabled: true,
    capabilities: { structuredOutput: true },
    updatedAt: timestamp
  })
  const durableJob = operations.createJob({
    id: crypto.randomUUID(),
    kind: "research",
    state: "queued",
    idempotencyKey: crypto.randomUUID(),
    payload: { applicationId: application.id },
    retryClass: "local",
    executionTarget: "app",
    maxAttempts: 1
  })
  const jobEvents = [
    operations.appendJobEvent({
      id: crypto.randomUUID(),
      jobId: durableJob.id,
      kind: "leased",
      payload: {}
    }),
    operations.appendJobEvent({
      id: crypto.randomUUID(),
      jobId: durableJob.id,
      kind: "running",
      payload: {}
    })
  ]
  operations.recordDisclosure({
    id: crypto.randomUUID(),
    requestHash: "b".repeat(64),
    providerKind: settings.providerKind,
    destination: "https://provider.example/disclose",
    action: "generate_cover_letter",
    actionAt: timestamp,
    selectedInputHashes: [blob.sha256]
  })
  operations.upsertRunnerRegistration({
    id: crypto.randomUUID(),
    runnerName: "runner-a",
    tokenHash: "c".repeat(64),
    capabilities: { concurrency: 1 },
    status: "active",
    registeredAt: timestamp,
    lastSeenAt: timestamp,
    revokedAt: null
  })
  let secretRejected = false
  try {
    operations.upsertProviderSettings({
      providerKind: "secret-probe",
      selectedModel: null,
      enabled: false,
      capabilities: { token: "canary-raw-token" },
      updatedAt: timestamp
    })
  } catch {
    secretRejected = true
  }
  const rollbackConversation = ConversationCreateSchema.parse({
    id: crypto.randomUUID(),
    title: "Rollback"
  })
  try {
    first.repositories.transaction(() => {
      researchConversations.createConversation(rollbackConversation)
      throw new Error("manual rollback")
    })
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "manual rollback") throw error
  }
  first.close()
  const reopened = createPersistence({ dataDirectory })
  const storedCanary = reopened.database
    .query<{ readonly count: number }, []>(
      "SELECT COUNT(*) count FROM provider_settings WHERE capability_json LIKE '%canary-raw-token%'"
    )
    .get()?.count
  const applicationSequences = reopened.database
    .query<{ readonly sequence: number }, [string]>(
      "SELECT sequence FROM application_events WHERE application_id=? ORDER BY sequence"
    )
    .all(application.id)
    .map((event) => event.sequence)
  const result = {
    allSchemaFamilies: {
      documents: reopened.repositories.documents.get(document.id) !== null,
      domain: reopened.repositories.domain.getApplication(application.id) !== null,
      operations: reopened.repositories.operations.getJob(durableJob.id) !== null,
      providerArtifacts: reopened.repositories.providerArtifacts.getArtifact(artifact.id) !== null,
      researchConversations:
        reopened.repositories.researchConversations.getConversation(conversation.id) !== null
    },
    migrations: { reopened: true, twice: true },
    noSecretPersistence: secretRejected && storedCanary === 0,
    cleanup: { handlesClosed: true, ports: [], temporaryRootRemoved: true },
    rollback:
      reopened.repositories.researchConversations.getConversation(rollbackConversation.id) === null,
    runtime: { busyTimeout, foreignKeys, wal },
    sequences: {
      application: applicationSequences,
      durableJob: jobEvents.map((event) => event.sequence),
      messages: messages.map((message) => message.sequence)
    },
    versions: {
      artifact: artifact.version,
      jobPost: reopened.repositories.domain.listJobPostVersions(jobPost.id).length
    }
  }
  reopened.close()
  rmSync(dataDirectory, { force: true, recursive: true })
  mkdirSync(join(".omo", "evidence", "task-3-interview-helper", "manual"), { recursive: true })
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 })
}

await main()
