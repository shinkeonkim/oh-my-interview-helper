import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ProviderIdSchema, ProviderKernel, ProviderRegistry, ToolRegistry } from "../src/agents"
import { createPersistence, type Persistence } from "../src/db"
import { DisclosureService } from "../src/disclosures/service"
import { StrandsChatExecutor } from "../src/workflows/strands-chat-executor"
import { WorkflowSourceContentResolver } from "../src/workflows/source-content"
import { FakeModel } from "../agents/fake-model"

const directories: string[] = []
const handles: Persistence[] = []
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("Strands application chat executor", () => {
  test("binds a cited structured chat response to one disclosure and provider run", async () => {
    const directory = mkdtempSync(join(tmpdir(), "strands-chat-"))
    directories.push(directory)
    const persistence = createPersistence({ dataDirectory: directory })
    handles.push(persistence)
    const post = persistence.repositories.domain.createJobPost({
      id: crypto.randomUUID(),
      title: "Backend",
      companyName: "Acme"
    })
    const version = persistence.repositories.domain.addJobPostVersion({
      id: crypto.randomUUID(),
      jobPostId: post.id,
      sourceKind: "manual",
      content: { text: "TypeScript role" }
    })
    const output = {
      answer: "공고의 TypeScript 요구사항과 경험을 연결하세요.",
      citations: [{ sourceId: version.id, note: "공고 요구사항" }]
    }
    const registry = new ProviderRegistry([
      {
        descriptor: {
          id: ProviderIdSchema.parse("openai-api"),
          mode: "api",
          model: { id: "fixture-chat", displayName: "Fixture", maxOutputTokens: 4096 },
          capabilities: { generation: true, structuredOutput: true, citedResearch: true }
        },
        enabled: true,
        createModel: () =>
          new FakeModel({
            modelId: "fixture-chat",
            steps: [{ kind: "structured", value: output }]
          }),
        health: async () => ({ kind: "healthy" })
      }
    ])
    persistence.repositories.operations.upsertProviderSettings({
      providerKind: "openai-api",
      selectedModel: "fixture-chat",
      enabled: true,
      capabilities: {},
      updatedAt: new Date().toISOString()
    })
    const disclosures = new DisclosureService({
      database: persistence.database,
      providers: registry,
      secret: new Uint8Array(32).fill(9)
    })
    const executor = new StrandsChatExecutor({
      kernel: new ProviderKernel({ providers: registry, tools: new ToolRegistry([]) }),
      providers: registry,
      providerRuns: persistence.repositories.providerArtifacts,
      disclosures,
      conversations: persistence.repositories.researchConversations,
      sources: new WorkflowSourceContentResolver(persistence.database)
    })
    const request = {
      conversationId: null,
      applicationId: crypto.randomUUID(),
      title: "지원 상담",
      message: "공고와 제 경험을 어떻게 연결할까요?",
      providerId: "openai-api",
      inputs: [{ kind: "job_post_version" as const, jobPostVersionId: version.id }]
    }
    const preview = executor.preview(request)
    expect(preview.manifest.action).toBe("application-chat")
    const confirmation = disclosures.confirm({ authorizationToken: preview.authorizationToken })
    const execution = await executor.execute({
      ...request,
      disclosureId: confirmation.id,
      signal: new AbortController().signal
    })
    expect(execution.output).toEqual(output)
    expect(
      persistence.repositories.providerArtifacts.getProviderRun(execution.providerRunId)
    ).toMatchObject({ status: "succeeded", providerKind: "openai-api" })
    await expect(
      executor.execute({
        ...request,
        disclosureId: confirmation.id,
        signal: new AbortController().signal
      })
    ).rejects.toThrow("CHAT_EXECUTOR_UNAVAILABLE")
  })
})
