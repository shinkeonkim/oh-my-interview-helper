import { describe, expect, test } from "bun:test"

import type {
  DraftArtifactRevision,
  DraftArtifactSeries
} from "../src/artifacts/draft-artifact-repository"
import {
  PreparationWorkflowError,
  PreparationWorkflowService,
  type PreparationArtifactWriter,
  type PreparationExecutor
} from "../src/workflows/service"

const inputId = "11111111-1111-4111-8111-111111111111"
const disclosureId = "22222222-2222-4222-8222-222222222222"
const runId = "33333333-3333-4333-8333-333333333333"

const harness = (sourceId = inputId) => {
  const series = new Map<string, DraftArtifactSeries>()
  const revisions: Array<Record<string, unknown>> = []
  const artifacts: PreparationArtifactWriter = {
    createSeries: (input) => {
      const value = { ...input, status: "draft" as const }
      series.set(input.id, value)
      return value
    },
    getSeries: (id) => series.get(id) ?? null,
    createRevision: (input) => {
      revisions.push(input)
      return {
        ...input,
        number: revisions.length,
        contentHash: "a".repeat(64),
        createdAt: new Date().toISOString()
      } as DraftArtifactRevision
    }
  }
  const executor: PreparationExecutor = {
    execute: async ({ workflow }) => ({
      providerRunId: runId,
      output: {
        workflow,
        title: "준비 자료",
        summary: "근거 기반 초안",
        questions: [
          {
            question: "질문",
            suggestedAnswer: "답변",
            rationale: "이유",
            citations: [{ sourceId, note: "근거" }]
          }
        ]
      }
    })
  }
  return { service: new PreparationWorkflowService(artifacts, executor), revisions }
}

describe("preparation workflow service", () => {
  for (const providerId of ["anthropic-api", "openai-api", "claude-cli", "codex-cli"])
    test(`persists a cited immutable revision for ${providerId}`, async () => {
      const { service, revisions } = harness()
      const result = await service.run(
        {
          workflow: "interview_prep",
          providerId,
          disclosureId,
          seriesId: null,
          inputs: [{ kind: "job_post_version", jobPostVersionId: inputId }],
          practiceAnswer: null
        },
        new AbortController().signal
      )
      expect(result.providerRunId).toBe(runId)
      expect(revisions[0]).toEqual(
        expect.objectContaining({ disclosureId, providerId, promptTemplateId: "interview-prep" })
      )
    })

  test("rejects fabricated citations without writing a partial revision", async () => {
    const { service, revisions } = harness("99999999-9999-4999-8999-999999999999")
    await expect(
      service.run(
        {
          workflow: "interview_prep",
          providerId: "anthropic-api",
          disclosureId,
          seriesId: null,
          inputs: [{ kind: "job_post_version", jobPostVersionId: inputId }],
          practiceAnswer: null
        },
        new AbortController().signal
      )
    ).rejects.toThrow(PreparationWorkflowError)
    expect(revisions).toHaveLength(0)
  })
})
