import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPersistence, type Persistence } from "../src/db"
import { ChatWorkflowError, ChatWorkflowService } from "../src/workflows/chat-service"

const directories: string[] = []
const handles: Persistence[] = []
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const setup = (citationId: string, inputId = citationId) => {
  const directory = mkdtempSync(join(tmpdir(), "chat-workflow-"))
  directories.push(directory)
  const persistence = createPersistence({ dataDirectory: directory })
  handles.push(persistence)
  const applicationId = crypto.randomUUID()
  const post = persistence.repositories.domain.createJobPost({
    id: crypto.randomUUID(),
    title: "Backend",
    companyName: "Acme",
    teamName: null
  })
  persistence.repositories.domain.addJobPostVersion({
    id: inputId,
    jobPostId: post.id,
    sourceKind: "manual",
    content: { text: "Public posting" }
  })
  const application = persistence.repositories.domain.createApplication({
    id: applicationId,
    jobPostId: post.id,
    idempotencyKey: crypto.randomUUID(),
    status: "saved"
  })
  const providerRun = persistence.repositories.providerArtifacts.createRunning({
    id: crypto.randomUUID(),
    providerKind: "openai-api",
    mode: "completion",
    model: "fixture",
    requestHash: "a".repeat(64)
  })
  const service = new ChatWorkflowService(
    persistence.repositories.researchConversations,
    {
      execute: async () => ({
        providerRunId: providerRun.id,
        output: { answer: "근거 기반 답변", citations: [{ sourceId: citationId, note: "공고" }] }
      })
    },
    persistence.database
  )
  return { application, service }
}

describe("per-application chat workflow", () => {
  test("stores an ordered user and cited assistant exchange", async () => {
    const inputId = crypto.randomUUID()
    const { application, service } = setup(inputId)
    const result = await service.send(
      {
        conversationId: null,
        applicationId: application.id,
        title: "면접 상담",
        message: "강점을 정리해줘",
        providerId: "openai-api",
        disclosureId: crypto.randomUUID(),
        inputs: [{ kind: "job_post_version", jobPostVersionId: inputId }]
      },
      new AbortController().signal
    )
    expect(result.messages.map((message) => message.role)).toEqual(["user", "assistant"])
    expect(service.messages(result.conversation.id)).toHaveLength(2)
    expect(service.list(application.id)).toHaveLength(1)
  })

  test("rejects fabricated citations without leaving a conversation", async () => {
    const citedId = crypto.randomUUID()
    const inputId = crypto.randomUUID()
    const { application, service } = setup(citedId, inputId)
    await expect(
      service.send(
        {
          conversationId: null,
          applicationId: application.id,
          title: "면접 상담",
          message: "답변",
          providerId: "claude-cli",
          disclosureId: crypto.randomUUID(),
          inputs: [{ kind: "job_post_version", jobPostVersionId: inputId }]
        },
        new AbortController().signal
      )
    ).rejects.toThrow(ChatWorkflowError)
    expect(service.list(application.id)).toHaveLength(0)
  })
})
