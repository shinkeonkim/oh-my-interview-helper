import type { DisclosureInputRef } from "../disclosures/sources"
import type {
  DraftArtifactRevision,
  DraftArtifactSeries
} from "../artifacts/draft-artifact-repository"
import type { DraftArtifactRevisionInput } from "../artifacts/draft-artifact-service"
import {
  PreparationRequestSchema,
  artifactKindForWorkflow,
  citationSourceIds,
  parsePreparationOutput,
  promptTemplateForWorkflow,
  type PreparationWorkflowKind
} from "./contracts"

export type PreparationExecution = {
  readonly output: unknown
  readonly providerRunId: string
}
export type PreparationExecutor = {
  readonly execute: (input: {
    readonly workflow: PreparationWorkflowKind
    readonly providerId: string
    readonly disclosureId: string
    readonly inputs: readonly DisclosureInputRef[]
    readonly practiceAnswer: string | null
    readonly signal: AbortSignal
  }) => Promise<PreparationExecution>
}
export type PreparationArtifactWriter = {
  readonly createSeries: (input: {
    readonly id: string
    readonly kind: DraftArtifactSeries["kind"]
  }) => DraftArtifactSeries
  readonly getSeries: (id: string) => DraftArtifactSeries | null
  readonly validateInputs: (inputs: readonly DisclosureInputRef[]) => void
  readonly createRevision: (input: DraftArtifactRevisionInput) => DraftArtifactRevision
}

export class PreparationWorkflowService {
  constructor(
    private readonly artifacts: PreparationArtifactWriter,
    private readonly executor: PreparationExecutor
  ) {}

  async run(raw: unknown, signal: AbortSignal): Promise<DraftArtifactRevision> {
    const request = PreparationRequestSchema.parse(raw)
    const expectedKind = artifactKindForWorkflow(request.workflow)
    const seriesId = request.seriesId ?? crypto.randomUUID()
    const existing = this.artifacts.getSeries(seriesId)
    if (existing !== null && (existing.kind !== expectedKind || existing.status !== "draft"))
      throw new PreparationWorkflowError("series_unavailable")
    this.artifacts.validateInputs(request.inputs)

    const execution = await this.executor.execute({
      workflow: request.workflow,
      providerId: request.providerId,
      disclosureId: request.disclosureId,
      inputs: request.inputs,
      practiceAnswer: request.practiceAnswer,
      signal
    })
    if (signal.aborted) throw new PreparationWorkflowError("cancelled")
    const content = parsePreparationOutput(request.workflow, execution.output)
    const allowedIds = new Set(request.inputs.map(referenceId))
    if (citationSourceIds(content).some((id) => !allowedIds.has(id)))
      throw new PreparationWorkflowError("citation_missing")
    if (existing === null) this.artifacts.createSeries({ id: seriesId, kind: expectedKind })
    return this.artifacts.createRevision({
      id: crypto.randomUUID(),
      seriesId,
      content,
      inputs: request.inputs,
      providerId: request.providerId,
      promptTemplateId: promptTemplateForWorkflow(request.workflow),
      providerRunId: execution.providerRunId,
      disclosureId: request.disclosureId
    })
  }
}

const referenceId = (input: DisclosureInputRef): string => {
  switch (input.kind) {
    case "document_version":
      return input.documentVersionId
    case "job_post_version":
      return input.jobPostVersionId
    case "research_source":
      return input.researchSourceId
    case "artifact_revision":
      return input.artifactRevisionId
  }
}

export class PreparationWorkflowError extends Error {
  override readonly name = "PreparationWorkflowError"
  constructor(readonly code: "series_unavailable" | "citation_missing" | "cancelled") {
    super(`PREPARATION_${code.toUpperCase()}`)
  }
}

export const unavailablePreparationExecutor: PreparationExecutor = {
  execute: async () => {
    throw new PreparationExecutorError("unavailable")
  }
}

export class PreparationExecutorError extends Error {
  override readonly name = "PreparationExecutorError"
  constructor(readonly code: "unavailable" | "provider_failed" | "invalid_output") {
    super(`PREPARATION_EXECUTOR_${code.toUpperCase()}`)
  }
}
