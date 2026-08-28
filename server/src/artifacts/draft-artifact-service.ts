import { z } from "zod"

import {
  DisclosureInputRefSchema,
  DisclosureSourceError,
  DisclosureSourceResolver
} from "../disclosures/sources"
import type { DisclosureInputRef } from "../disclosures/sources"
import type {
  CurrentGenerationContextResolver,
  ProviderContextResolution
} from "./current-generation-context"
import type {
  DraftArtifactRepository,
  DraftArtifactRevision,
  DraftArtifactSeries
} from "./draft-artifact-repository"

const JsonSchema = z.record(z.string(), z.json())
const RevisionCreateSchema = z
  .object({
    id: z.string().uuid(),
    seriesId: z.string().uuid(),
    content: JsonSchema,
    inputs: z.array(DisclosureInputRefSchema).min(1),
    providerId: z.string().trim().min(1),
    promptTemplateId: z.string().trim().min(1),
    providerRunId: z.string().uuid().nullable(),
    disclosureId: z.string().uuid().nullable()
  })
  .strict()
export type DraftArtifactProvenance = DraftArtifactRevision & {
  readonly inputs: readonly {
    readonly ref: DisclosureInputRef
    readonly hash: string
    readonly label: string
    readonly version: number | null
  }[]
  readonly staleReasons: readonly DraftArtifactStaleReason[]
}
export const DraftArtifactStaleReasonSchema = z.enum([
  "source_content_changed",
  "source_current_version_changed",
  "source_unavailable",
  "provider_disabled",
  "provider_unavailable",
  "provider_changed",
  "model_changed",
  "mode_changed",
  "prompt_missing",
  "prompt_changed"
])
export type DraftArtifactStaleReason = z.output<typeof DraftArtifactStaleReasonSchema>

export class DraftArtifactService {
  private readonly sources: DisclosureSourceResolver
  constructor(
    private readonly repository: DraftArtifactRepository,
    private readonly current: CurrentGenerationContextResolver,
    database: ConstructorParameters<typeof DisclosureSourceResolver>[0]
  ) {
    this.sources = new DisclosureSourceResolver(database)
  }
  createSeries(input: {
    readonly id: string
    readonly kind: DraftArtifactSeries["kind"]
  }): DraftArtifactSeries {
    return this.repository.createSeries(input)
  }
  createRevision(input: z.input<typeof RevisionCreateSchema>): DraftArtifactRevision {
    const value = RevisionCreateSchema.parse(input)
    const provider = this.current.resolveProvider(value.providerId)
    if (provider.kind !== "current") throw new CurrentGenerationContextError(provider.kind)
    const prompt = this.current.resolvePrompt(value.promptTemplateId)
    if (prompt === null) throw new CurrentGenerationContextError("prompt_missing")
    return this.repository.createRevision({
      ...value,
      providerId: provider.context.providerId,
      providerMode: provider.context.mode,
      providerModel: provider.context.model,
      providerCapabilityRevision: provider.context.capabilityRevision,
      promptTemplateId: prompt.id,
      promptTemplateRevision: prompt.revision,
      inputs: value.inputs.map((ref) => {
        const resolved = this.sources.resolve(ref)
        return {
          kind: ref.kind,
          ref,
          hash: resolved.hash,
          label: resolved.label,
          version: resolved.version,
          parentCurrentId: resolved.parentCurrentId
        }
      })
    })
  }
  getRevision(id: string): DraftArtifactRevision | null {
    return this.repository.getRevision(id)
  }
  listRevisions(seriesId: string): readonly DraftArtifactRevision[] {
    return this.repository.listRevisions(seriesId)
  }
  getProvenance(id: string): DraftArtifactProvenance {
    const stored = this.repository.getStoredProvenance(id)
    const reasons = new Set<DraftArtifactStaleReason>()
    for (const input of stored.inputs) {
      const ref = DisclosureInputRefSchema.parse(input.ref)
      try {
        const current = this.sources.resolve(ref)
        if (current.hash !== input.hash) reasons.add("source_content_changed")
        if (current.parentCurrentId !== input.parentCurrentId)
          reasons.add("source_current_version_changed")
      } catch (error) {
        if (error instanceof DisclosureSourceError) reasons.add("source_unavailable")
        else throw error
      }
    }
    this.addProviderReasons({ stored, reasons })
    const prompt = this.current.resolvePrompt(stored.promptTemplateId)
    if (prompt === null) reasons.add("prompt_missing")
    else if (prompt.revision !== stored.promptTemplateRevision) reasons.add("prompt_changed")
    return {
      ...stored,
      inputs: stored.inputs.map((input) => ({
        ref: DisclosureInputRefSchema.parse(input.ref),
        hash: input.hash,
        label: input.label,
        version: input.version
      })),
      staleReasons: [...reasons].sort()
    }
  }
  archive(id: string): void {
    this.repository.archive(id)
  }
  logicalDelete(id: string): void {
    this.repository.logicalDelete(id)
  }
  private addProviderReasons(input: {
    readonly stored: DraftArtifactRevision
    readonly reasons: Set<DraftArtifactStaleReason>
  }): void {
    const resolution = this.current.resolveProvider(input.stored.providerId)
    if (resolution.kind === "disabled") input.reasons.add("provider_disabled")
    if (resolution.kind === "unavailable") input.reasons.add("provider_unavailable")
    if (resolution.kind === "changed") this.addChangedProviderReasons({ ...input, resolution })
    if (resolution.kind === "current") this.addCurrentProviderReasons({ ...input, resolution })
  }
  private addChangedProviderReasons(input: {
    readonly stored: DraftArtifactRevision
    readonly resolution: Extract<ProviderContextResolution, { readonly kind: "changed" }>
    readonly reasons: Set<DraftArtifactStaleReason>
  }): void {
    this.addCurrentProviderReasons(input)
    input.reasons.add("provider_changed")
  }
  private addCurrentProviderReasons(input: {
    readonly stored: DraftArtifactRevision
    readonly resolution: Extract<ProviderContextResolution, { readonly context: unknown }>
    readonly reasons: Set<DraftArtifactStaleReason>
  }): void {
    if (input.resolution.context.mode !== input.stored.providerMode)
      input.reasons.add("mode_changed")
    if (input.resolution.context.model !== input.stored.providerModel)
      input.reasons.add("model_changed")
    if (input.resolution.context.capabilityRevision !== input.stored.providerCapabilityRevision)
      input.reasons.add("provider_changed")
  }
}

export class CurrentGenerationContextError extends Error {
  override readonly name = "CurrentGenerationContextError"
  constructor(readonly code: "disabled" | "unavailable" | "changed" | "prompt_missing") {
    super(`CURRENT_GENERATION_CONTEXT_${code.toUpperCase()}`)
  }
}
