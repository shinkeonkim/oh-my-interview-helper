import { z } from "zod"

import {
  ArtifactIdSchema,
  DocumentVersionIdSchema,
  JobPostVersionIdSchema,
  ProviderRunIdSchema,
  ResearchRecordIdSchema
} from "./ids"

const TimestampSchema = z.string().datetime()
const JsonObjectSchema = z.record(z.string(), z.json())
const SourceHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .brand<"SourceHash">()
export const ProviderRequestHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .brand<"ProviderRequestHash">()

export const ProviderRunModeSchema = z.enum(["chat", "completion", "embedding", "tool"])
export const ProviderRunStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled"
])
const ProviderUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.totalTokens !== value.inputTokens + value.outputTokens + value.cacheTokens)
      context.addIssue({ code: "custom", message: "Provider usage total must match components" })
  })
  .nullable()
const ProviderCostSchema = z
  .object({ currency: z.literal("USD"), microunits: z.number().int().nonnegative() })
  .strict()
  .nullable()
const ProviderErrorSchema = z
  .object({
    category: z.enum([
      "provider_unavailable",
      "rate_limited",
      "invalid_response",
      "invalid_output",
      "timeout",
      "cancelled",
      "provider_failure"
    ]),
    retryable: z.boolean()
  })
  .strict()
  .nullable()
export const ProviderRunMetadataSchema = z
  .object({
    mode: ProviderRunModeSchema,
    model: z.string().trim().min(1).max(256),
    usage: ProviderUsageSchema,
    cost: ProviderCostSchema,
    error: ProviderErrorSchema
  })
  .strict()
export const ProviderRunCreateSchema = z
  .object({
    id: ProviderRunIdSchema,
    providerKind: z.string().trim().min(1).max(128),
    mode: ProviderRunModeSchema,
    model: z.string().trim().min(1).max(256),
    requestHash: ProviderRequestHashSchema,
    status: ProviderRunStatusSchema,
    usage: ProviderUsageSchema,
    cost: ProviderCostSchema,
    error: ProviderErrorSchema,
    completedAt: TimestampSchema.nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "running" && (value.completedAt !== null || value.error !== null))
      context.addIssue({ code: "custom", message: "Running provider run cannot be terminal" })
    if (value.status === "succeeded" && (value.completedAt === null || value.error !== null))
      context.addIssue({ code: "custom", message: "Succeeded provider run must be complete" })
    if (
      (value.status === "failed" || value.status === "cancelled") &&
      (value.completedAt === null || value.error === null)
    )
      context.addIssue({
        code: "custom",
        message: "Terminal provider failure requires sanitized error"
      })
  })
export type ProviderRun = z.output<typeof ProviderRunCreateSchema>

export const ArtifactKindSchema = z.enum([
  "cover_letter",
  "resume",
  "interview_brief",
  "application_answer"
])
export const ArtifactStatusSchema = z.enum(["draft", "archived", "deleted"])
export const ArtifactCreateSchema = z
  .object({
    id: ArtifactIdSchema,
    kind: ArtifactKindSchema,
    status: ArtifactStatusSchema,
    providerRunId: ProviderRunIdSchema.nullable(),
    bodyBlobHash: SourceHashSchema.nullable().default(null),
    version: z.number().int().positive(),
    content: JsonObjectSchema
  })
  .strict()
export type Artifact = z.output<typeof ArtifactCreateSchema>

export const ArtifactInputSourceKindSchema = z.enum([
  "document_version",
  "job_post_version",
  "research_record",
  "source_hash"
])
const ArtifactInputSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("document_version"), documentVersionId: DocumentVersionIdSchema })
    .strict(),
  z
    .object({ kind: z.literal("job_post_version"), jobPostVersionId: JobPostVersionIdSchema })
    .strict(),
  z
    .object({ kind: z.literal("research_record"), researchRecordId: ResearchRecordIdSchema })
    .strict(),
  z.object({ kind: z.literal("source_hash"), sourceHash: SourceHashSchema }).strict()
])
export const ArtifactInputCreateSchema = z
  .object({ artifactId: ArtifactIdSchema, source: ArtifactInputSourceSchema })
  .strict()
export type ArtifactInput = z.output<typeof ArtifactInputCreateSchema>
export type ArtifactInputSourceKind = z.output<typeof ArtifactInputSourceKindSchema>
export type ArtifactKind = z.output<typeof ArtifactKindSchema>

const StoredJsonSchema = <Schema extends z.ZodType>(schema: Schema) =>
  z
    .string()
    .transform((value, context) => {
      try {
        return JSON.parse(value)
      } catch {
        context.addIssue({ code: "custom", message: "Invalid persisted JSON" })
        return z.NEVER
      }
    })
    .pipe(schema)

const ProviderRunRowSchema = z.object({
  id: ProviderRunIdSchema,
  providerKind: z.string(),
  status: ProviderRunStatusSchema,
  requestHash: ProviderRequestHashSchema,
  metadata: StoredJsonSchema(ProviderRunMetadataSchema),
  completedAt: TimestampSchema.nullable()
})
const ArtifactRowSchema = z.object({
  id: ArtifactIdSchema,
  kind: ArtifactKindSchema,
  status: ArtifactStatusSchema,
  providerRunId: ProviderRunIdSchema.nullable(),
  bodyBlobHash: SourceHashSchema.nullable(),
  version: z.number().int().positive(),
  content: StoredJsonSchema(JsonObjectSchema)
})
const ArtifactInputRowSchema = z
  .object({
    artifactId: ArtifactIdSchema,
    sourceKind: ArtifactInputSourceKindSchema,
    documentVersionId: DocumentVersionIdSchema.nullable(),
    jobPostVersionId: JobPostVersionIdSchema.nullable(),
    researchRecordId: ResearchRecordIdSchema.nullable(),
    sourceHash: SourceHashSchema.nullable()
  })
  .superRefine((value, context) => {
    const sourceCount = [
      value.documentVersionId,
      value.jobPostVersionId,
      value.researchRecordId,
      value.sourceHash
    ].filter((source) => source !== null).length
    if (sourceCount !== 1)
      context.addIssue({ code: "custom", message: "Expected exactly one input source" })
  })

export const mapProviderRun = (row: unknown): ProviderRun => {
  const value = ProviderRunRowSchema.parse(row)
  return ProviderRunCreateSchema.parse({
    id: value.id,
    providerKind: value.providerKind,
    ...value.metadata,
    requestHash: value.requestHash,
    status: value.status,
    completedAt: value.completedAt
  })
}
export const mapArtifact = (row: unknown): Artifact =>
  ArtifactCreateSchema.parse(ArtifactRowSchema.parse(row))
export const mapArtifactInput = (row: unknown): ArtifactInput => {
  const value = ArtifactInputRowSchema.parse(row)
  switch (value.sourceKind) {
    case "document_version":
      return ArtifactInputCreateSchema.parse({
        artifactId: value.artifactId,
        source: { kind: value.sourceKind, documentVersionId: value.documentVersionId }
      })
    case "job_post_version":
      return ArtifactInputCreateSchema.parse({
        artifactId: value.artifactId,
        source: { kind: value.sourceKind, jobPostVersionId: value.jobPostVersionId }
      })
    case "research_record":
      return ArtifactInputCreateSchema.parse({
        artifactId: value.artifactId,
        source: { kind: value.sourceKind, researchRecordId: value.researchRecordId }
      })
    case "source_hash":
      return ArtifactInputCreateSchema.parse({
        artifactId: value.artifactId,
        source: { kind: value.sourceKind, sourceHash: value.sourceHash }
      })
  }
}
