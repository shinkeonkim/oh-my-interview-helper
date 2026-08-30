import type { JobDefinition } from "./runtime"
import type { JobsRepository } from "./repository"
import type { ResearchService } from "../research/service"
import type { JobDiscoveryService } from "../job-search/service"
import type { PreparationWorkflowService } from "../workflows/service"
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
    const result = await service.discover(job.payload["request"], signal)
    progress(jobs, job.id, { phase: "result", recommendations: result.recommendations })
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
    const result = await service.run(job.payload["request"], signal)
    progress(jobs, job.id, { phase: "result", revision: result })
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
