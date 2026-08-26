import { z } from "zod"

export const ProviderIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/)
  .brand<"ProviderId">()
export const ToolIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/)
  .brand<"ToolId">()
export const ProviderModeSchema = z.enum(["api", "runner", "test"])
export const ProviderCapabilitySchema = z
  .object({
    generation: z.boolean(),
    structuredOutput: z.boolean(),
    citedResearch: z.boolean()
  })
  .strict()
export const ModelDescriptorSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    displayName: z.string().trim().min(1).max(128),
    maxOutputTokens: z.number().int().positive()
  })
  .strict()
export const ProviderDescriptorSchema = z
  .object({
    id: ProviderIdSchema,
    mode: ProviderModeSchema,
    model: ModelDescriptorSchema,
    capabilities: ProviderCapabilitySchema
  })
  .strict()
export const ProviderHealthSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("healthy") }).strict(),
  z
    .object({
      kind: z.literal("unavailable"),
      code: z.enum(["disabled", "unconfigured", "unreachable"])
    })
    .strict()
])
export const NeutralMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z
      .array(z.object({ kind: z.literal("text"), text: z.string().max(100_000) }).strict())
      .min(1)
  })
  .strict()
export const TextOutputSchema = z.object({ kind: z.literal("text") }).strict()
export const InvocationShapeSchema = z
  .object({
    providerId: ProviderIdSchema,
    messages: z.array(NeutralMessageSchema).min(1),
    toolIds: z.array(ToolIdSchema).max(16),
    timeoutMilliseconds: z.number().int().positive().max(120_000).optional()
  })
  .strict()

export type ProviderId = z.output<typeof ProviderIdSchema>
export type ToolId = z.output<typeof ToolIdSchema>
export type ProviderDescriptor = z.output<typeof ProviderDescriptorSchema>
export type ProviderHealth = z.output<typeof ProviderHealthSchema>
export type NeutralMessage = z.output<typeof NeutralMessageSchema>
export type ProviderUsage = {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheTokens: number
  readonly totalTokens: number
}
export type ProviderCost = { readonly currency: "USD"; readonly microunits: number } | null
export type ProviderErrorCode =
  | "provider_unavailable"
  | "disabled"
  | "tool_denied"
  | "invalid_output"
  | "timeout"
  | "cancelled"
  | "limit_exceeded"
  | "provider_failure"
export type ProviderError = { readonly code: ProviderErrorCode; readonly retryable: boolean }
export type ProviderOutput =
  { readonly kind: "text" } | { readonly kind: "structured"; readonly schema: z.ZodType }
export type ProviderInvocation = z.output<typeof InvocationShapeSchema> & {
  readonly output: ProviderOutput
  readonly signal?: AbortSignal
}
export type ProviderEvent =
  | { readonly kind: "started"; readonly providerId: ProviderId; readonly model: string }
  | { readonly kind: "text_delta"; readonly text: string }
  | { readonly kind: "tool_started"; readonly toolId: ToolId }
  | { readonly kind: "tool_result"; readonly toolId: ToolId; readonly status: "success" | "error" }
  | { readonly kind: "usage"; readonly usage: ProviderUsage }
  | {
      readonly kind: "completed"
      readonly usage: ProviderUsage | null
      readonly cost: ProviderCost
    }
  | {
      readonly kind: "failed"
      readonly error: ProviderError
      readonly usage: ProviderUsage | null
      readonly cost: ProviderCost
    }
  | {
      readonly kind: "cancelled"
      readonly usage: ProviderUsage | null
      readonly cost: ProviderCost
    }
export type ProviderResult =
  | {
      readonly kind: "completed"
      readonly text: string
      readonly structured: unknown | null
      readonly usage: ProviderUsage | null
      readonly cost: ProviderCost
    }
  | {
      readonly kind: "failed"
      readonly error: ProviderError
      readonly usage: ProviderUsage | null
      readonly cost: ProviderCost
    }
  | {
      readonly kind: "cancelled"
      readonly usage: ProviderUsage | null
      readonly cost: ProviderCost
    }

export const assertNever = (value: never): never => {
  throw new Error(`Unexpected variant: ${JSON.stringify(value)}`)
}
