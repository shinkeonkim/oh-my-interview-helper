import { z } from "zod"

import type { ProviderArtifactRepository } from "../db/provider-artifact-repositories"
import { ProviderRunIdSchema } from "../db/ids"
import {
  ProviderRequestHashSchema,
  type ProviderRun
} from "../db/provider-artifact-repository-schemas"
import type { JobsRepository } from "../jobs/repository"
import type { JobDefinition, JobTerminalContext } from "../jobs/runtime"
import type { Job } from "../jobs/types"
import type { ProviderKernel } from "./kernel"
import { ProviderIdSchema, ProviderModeSchema, type ProviderInvocation } from "./contracts"
import { ProviderInvokeCoordinator } from "./provider-invoke-coordinator"
import { providerInvocationHash } from "./provider-invocation-hash"
import { collectProviderStream } from "./provider-stream"

const ProviderInvokePayloadSchema = z
  .object({
    runId: ProviderRunIdSchema,
    providerId: ProviderIdSchema,
    mode: ProviderModeSchema,
    model: z.string().trim().min(1).max(128),
    requestHash: ProviderRequestHashSchema,
    disclosureId: z.string().uuid().optional()
  })
  .strict()
type ProviderInvokePayload = z.output<typeof ProviderInvokePayloadSchema>
export type ProviderInvokeAuthorization = {
  readonly consume: (payload: ProviderInvokePayload) => boolean
}
export type ProviderRequestSource = {
  readonly resolve: (payload: ProviderInvokePayload) => ProviderInvocation | null
}
export const unavailableProviderRequestSource: ProviderRequestSource = { resolve: () => null }
export type ProviderInvokeJobDefinition = JobDefinition & { readonly pendingCount: () => number }
export const createProviderInvokeJobDefinition = (dependencies: {
  readonly kernel: ProviderKernel
  readonly providerRuns: ProviderArtifactRepository
  readonly jobs: JobsRepository
  readonly requests: ProviderRequestSource
  readonly authorization?: ProviderInvokeAuthorization
}): ProviderInvokeJobDefinition => {
  const outcomes = new ProviderInvokeCoordinator<ProviderTerminal>()
  const complete = (context: JobTerminalContext): void => {
    const payload = ProviderInvokePayloadSchema.parse(context.job.payload)
    const outcome = outcomes.take(context.job.id)
    const existing = dependencies.providerRuns.getProviderRun(payload.runId)
    if (existing === null || existing.status !== "running") return
    const terminal = terminalFor(context, outcome)
    dependencies.providerRuns.transitionInTransaction(payload.runId, terminal)
  }
  const reconcile = (job: Job): void => {
    const state = job.state
    if (state !== "succeeded" && state !== "failed" && state !== "cancelled") return
    dependencies.providerRuns.transaction(() => complete({ job, state, reason: "interrupted" }))
  }
  return {
    kind: "provider-invoke",
    retryClass: "external",
    maxAttempts: 1,
    pendingCount: () => outcomes.size,
    terminal: complete,
    reconcile,
    run: async ({ job, signal }) => {
      outcomes.register(job.id)
      const payload = ProviderInvokePayloadSchema.parse(job.payload)
      dependencies.providerRuns.createRunning({
        id: payload.runId,
        providerKind: payload.providerId,
        mode: "completion",
        model: payload.model,
        requestHash: payload.requestHash
      })
      const descriptor = dependencies.kernel.descriptor(payload.providerId)
      if (
        descriptor === null ||
        descriptor.mode !== payload.mode ||
        descriptor.model.id !== payload.model
      ) {
        outcomes.report(job.id, unavailableTerminal())
        throw new ProviderInvokeJobError()
      }
      const request = dependencies.requests.resolve(payload)
      if (request === null) {
        outcomes.report(job.id, unavailableTerminal())
        throw new ProviderInvokeJobError()
      }
      if (request.providerId !== payload.providerId) {
        outcomes.report(job.id, unavailableTerminal())
        throw new ProviderInvokeJobError()
      }
      if (providerInvocationHash(request) !== payload.requestHash) {
        outcomes.report(job.id, unavailableTerminal())
        throw new ProviderInvokeJobError()
      }
      if (dependencies.authorization?.consume(payload) !== true) {
        outcomes.report(job.id, unavailableTerminal())
        throw new ProviderInvokeJobError()
      }
      const completed = await collectProviderStream(
        dependencies.kernel.stream({ ...request, signal })
      )
      for (const event of completed.events) {
        if (
          event.kind === "started" ||
          event.kind === "text_delta" ||
          event.kind === "usage" ||
          event.kind === "tool_started" ||
          event.kind === "tool_result"
        )
          dependencies.jobs.appendProgress({
            id: job.id,
            payload: { provider: payload.providerId, phase: event.kind },
            now: new Date().toISOString()
          })
      }
      switch (completed.result.kind) {
        case "completed":
          outcomes.report(job.id, {
            status: "succeeded",
            usage: completed.result.usage,
            cost: completed.result.cost,
            error: null
          })
          return
        case "cancelled":
          outcomes.report(job.id, cancelledTerminal(completed.result.usage, completed.result.cost))
          return
        case "failed":
          outcomes.report(job.id, failedTerminal(completed.result))
          throw new ProviderInvokeJobError()
        default:
          return assertNever(completed.result)
      }
    }
  }
}
type ProviderTerminal = {
  readonly status: "succeeded" | "failed" | "cancelled"
  readonly usage: ProviderRun["usage"]
  readonly cost: ProviderRun["cost"]
  readonly error: ProviderRun["error"]
}
const unavailableTerminal = (): ProviderTerminal => ({
  status: "failed",
  usage: null,
  cost: null,
  error: { category: "provider_unavailable", retryable: false }
})
const cancelledTerminal = (
  usage: ProviderRun["usage"],
  cost: ProviderRun["cost"]
): ProviderTerminal => ({
  status: "cancelled",
  usage,
  cost,
  error: { category: "cancelled", retryable: false }
})
const failedTerminal = (
  result: Extract<Awaited<ReturnType<typeof collectProviderStream>>["result"], { kind: "failed" }>
): ProviderTerminal => ({
  status: "failed",
  usage: result.usage,
  cost: result.cost,
  error: {
    category:
      result.error.code === "invalid_output"
        ? "invalid_output"
        : result.error.code === "timeout"
          ? "timeout"
          : "provider_failure",
    retryable: result.error.retryable
  }
})
const terminalFor = (
  context: JobTerminalContext,
  outcome: ProviderTerminal | undefined
): ProviderTerminal => {
  if (context.state === "cancelled")
    return cancelledTerminal(outcome?.usage ?? null, outcome?.cost ?? null)
  if (context.state === "succeeded" && outcome?.status === "succeeded") return outcome
  if (context.reason === "timeout")
    return {
      status: "failed",
      usage: null,
      cost: null,
      error: { category: "timeout", retryable: false }
    }
  return outcome?.status === "failed" ? outcome : unavailableTerminal()
}
const assertNever = (value: never): never => {
  throw new Error(`Unexpected provider result ${JSON.stringify(value)}`)
}
export class ProviderInvokeJobError extends Error {
  override readonly name = "ProviderInvokeJobError"
  constructor() {
    super("PROVIDER_INVOKE_FAILED")
  }
}
