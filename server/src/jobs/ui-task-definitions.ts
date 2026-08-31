import type { JobDefinition } from "./runtime"
import type { JobsRepository } from "./repository"
import type { ResearchService } from "../research/service"
import { JobDiscoveryError, type JobDiscoveryService } from "../job-search/service"
import type { PreparationWorkflowService } from "../workflows/service"
import { PreparationWorkflowError } from "../workflows/service"
import { DraftArtifactError } from "../artifacts/draft-artifact-repository"
import { CurrentGenerationContextError } from "../artifacts/draft-artifact-service"
import type { ChatWorkflowService } from "../workflows/chat-service"
import { z } from "zod"

const progress = (jobs: JobsRepository, id: string, payload: Record<string, unknown>) =>
  jobs.appendProgress({
    id,
    payload: z.record(z.string(), z.json()).parse(payload),
    now: new Date().toISOString()
  })

export const researchTaskDefinition = (
  service: ResearchService,
  jobs: JobsRepository
): JobDefinition => ({
  kind: "ui.research",
  retryClass: "external",
  maxAttempts: 1,
  run: async ({ job, signal }) => {
    progress(jobs, job.id, { phase: "researching" })
    const payload = job.payload as { action?: unknown; recordId?: unknown; request?: unknown }
    const result =
      payload.action === "refresh" && typeof payload.recordId === "string"
        ? await service.refresh(
            payload.recordId,
            ((payload.request as { sourceUrls?: unknown })?.sourceUrls ?? []) as string[],
            signal
          )
        : await service.run(payload.request, signal)
    progress(jobs, job.id, { phase: "result", recordId: result?.id ?? null })
  }
})

export const jobDiscoveryTaskDefinition = (
  service: JobDiscoveryService,
  jobs: JobsRepository
): JobDefinition => ({
  kind: "ui.job_discovery",
  retryClass: "external",
  maxAttempts: 1,
  run: async ({ job, signal }) => {
    progress(jobs, job.id, { phase: "searching" })
    try {
      const result = await service.discover(job.payload["request"], signal)
      progress(jobs, job.id, { phase: "result", recommendations: result.recommendations })
    } catch (error) {
      progress(jobs, job.id, {
        phase: "failed",
        code:
          error instanceof JobDiscoveryError
            ? error.code
            : error instanceof z.ZodError
              ? "schema_validation_failed"
              : "discovery_failed",
        errorType: error instanceof Error ? error.name : "unknown"
      })
      throw error
    }
  }
})

export const preparationTaskDefinition = (
  service: PreparationWorkflowService,
  jobs: JobsRepository
): JobDefinition => ({
  kind: "ui.preparation",
  retryClass: "external",
  maxAttempts: 1,
  run: async ({ job, signal }) => {
    progress(jobs, job.id, { phase: "generating" })
    try {
      const result = await service.run(job.payload["request"], signal)
      progress(jobs, job.id, { phase: "result", revisionId: result.id })
    } catch (error) {
      const code =
        error instanceof PreparationWorkflowError
          ? error.code
          : error instanceof DraftArtifactError
            ? error.code
            : error instanceof CurrentGenerationContextError
              ? error.code
              : error instanceof z.ZodError
                ? "schema_validation_failed"
                : "generation_failed"
      progress(jobs, job.id, {
        phase: "failed",
        code,
        errorType: error instanceof Error ? error.name : "unknown"
      })
      throw error
    }
  }
})

export const chatTaskDefinition = (
  service: ChatWorkflowService,
  jobs: JobsRepository
): JobDefinition => ({
  kind: "ui.chat",
  retryClass: "external",
  maxAttempts: 1,
  run: async ({ job, signal }) => {
    progress(jobs, job.id, { phase: "answering" })
    const result = await service.send(job.payload["request"], signal)
    progress(jobs, job.id, { phase: "result", ...result })
  }
})
