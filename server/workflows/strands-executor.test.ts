import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ProviderIdSchema, ProviderKernel, ProviderRegistry, ToolRegistry } from "../src/agents"
import { createPersistence, type Persistence } from "../src/db"
import { DisclosureService } from "../src/disclosures/service"
import { StrandsPreparationExecutor } from "../src/workflows/strands-executor"
import { WorkflowSourceContentResolver } from "../src/workflows/source-content"
import { FakeModel } from "../agents/fake-model"

const directories: string[] = []
const handles: Persistence[] = []
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("Strands preparation executor", () => {
  test("previews, consumes consent once, invokes Strands, and persists provider success", async () => {
    const directory = mkdtempSync(join(tmpdir(), "strands-workflow-"))
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
      content: { text: "TypeScript platform role" }
    })
    const output = {
      workflow: "cover_letter",
      title: "지원 동기",
      summary: "근거 기반 초안",
      sections: [
        {
          heading: "경험",
          body: "플랫폼 경험을 연결합니다.",
          citations: [{ sourceId: version.id, note: "채용 공고" }]
        }
      ]
    }
    const registry = new ProviderRegistry([
      {
        descriptor: {
          id: ProviderIdSchema.parse("anthropic-api"),
          mode: "api",
          model: { id: "fixture-model", displayName: "Fixture", maxOutputTokens: 4096 },
          capabilities: { generation: true, structuredOutput: true, citedResearch: true }
        },
        enabled: true,
        createModel: () =>
          new FakeModel({
            modelId: "fixture-model",
            steps: [{ kind: "structured", value: output }]
          }),
        health: async () => ({ kind: "healthy" })
      }
    ])
    persistence.repositories.operations.upsertProviderSettings({
      providerKind: "anthropic-api",
      selectedModel: "fixture-model",
      enabled: true,
      capabilities: {},
      updatedAt: new Date().toISOString()
    })
    const disclosures = new DisclosureService({
      database: persistence.database,
      providers: registry,
      secret: new Uint8Array(32).fill(7)
    })
    const executor = new StrandsPreparationExecutor({
      kernel: new ProviderKernel({ providers: registry, tools: new ToolRegistry([]) }),
      providers: registry,
      providerRuns: persistence.repositories.providerArtifacts,
      disclosures,
      sources: new WorkflowSourceContentResolver(persistence.database)
    })
    const request = {
      workflow: "cover_letter" as const,
      providerId: "anthropic-api",
      seriesId: null,
      inputs: [{ kind: "job_post_version" as const, jobPostVersionId: version.id }],
      practiceAnswer: null,
      generationKey: crypto.randomUUID()
    }
    const preview = executor.preview(request)
    expect(preview.manifest.action).toBe("prepare:cover_letter")
    const confirmation = disclosures.confirm({ authorizationToken: preview.authorizationToken })
    const execution = await executor.execute({
      ...request,
      disclosureId: confirmation.id,
      signal: new AbortController().signal
    })
    expect(execution.output).toEqual(output)
    expect(
      persistence.repositories.providerArtifacts.getProviderRun(execution.providerRunId)
    ).toMatchObject({
      status: "succeeded",
      providerKind: "anthropic-api"
    })
    await expect(
      executor.execute({
        ...request,
        disclosureId: confirmation.id,
        signal: new AbortController().signal
      })
    ).rejects.toThrow("PREPARATION_EXECUTOR_UNAVAILABLE")
    const regeneration = { ...request, generationKey: crypto.randomUUID() }
    const regenerationPreview = executor.preview(regeneration)
    const regenerationConfirmation = disclosures.confirm({
      authorizationToken: regenerationPreview.authorizationToken
    })
    const regenerated = await executor.execute({
      ...regeneration,
      disclosureId: regenerationConfirmation.id,
      signal: new AbortController().signal
    })
    expect(regenerated.providerRunId).not.toBe(execution.providerRunId)
  })
})
