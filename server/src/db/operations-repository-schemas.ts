import { z } from "zod"

import { DurableJobIdSchema } from "./ids"

const identifier = <Name extends string>() => z.string().uuid().brand<Name>()
const TimestampSchema = z.string().datetime()
const JsonObjectSchema = z.record(z.string(), z.json())
const HashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .brand<"OperationHash">()
const DurableJobStateSchema = z.enum([
  "queued",
  "leased",
  "running",
  "succeeded",
  "failed",
  "cancelled"
])
const RunnerRegistrationStatusSchema = z.enum(["active", "revoked"])
const StoredJsonObjectSchema = z
  .string()
  .transform((value, context) => {
    try {
      return JSON.parse(value)
    } catch {
      context.addIssue({ code: "custom", message: "Invalid JSON object" })
      return z.NEVER
    }
  })
  .pipe(JsonObjectSchema)
const StoredHashArraySchema = z
  .string()
  .transform((value, context) => {
    try {
      return JSON.parse(value)
    } catch {
      context.addIssue({ code: "custom", message: "Invalid hash array JSON" })
      return z.NEVER
    }
  })
  .pipe(z.array(HashSchema).min(1))
const hasSecretLikeKey = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasSecretLikeKey)
  if (typeof value !== "object" || value === null) return false
  return Object.entries(value).some(
    ([key, child]) =>
      /api[_-]?key|token|secret|password|credential|authorization|bearer/i.test(key) ||
      hasSecretLikeKey(child)
  )
}
const CapabilitySchema = JsonObjectSchema.superRefine((value, context) => {
  if (hasSecretLikeKey(value))
    context.addIssue({ code: "custom", message: "Provider capabilities cannot contain secrets" })
})
const SanitizedErrorMessageSchema = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .regex(/^[\x20-\x7e]*$/)
  .refine(
    (value) =>
      !/(api[_-]?key|token|secret|password|credential|authorization|bearer)\s*[:=]/i.test(value),
    "Durable job errors cannot contain secrets"
  )
const SanitizedErrorCodeSchema = z
  .string()
  .regex(/^[a-z0-9_]+$/)
  .max(128)
const validateDurableState = (
  value: {
    readonly state: z.output<typeof DurableJobStateSchema>
    readonly leaseOwner: z.output<typeof RunnerNameSchema> | null
    readonly leaseExpiresAt: string | null
    readonly errorCode: string | null
    readonly errorMessage: string | null
  },
  context: z.RefinementCtx
): void => {
  const hasLease = value.leaseOwner !== null && value.leaseExpiresAt !== null
  const hasError = value.errorCode !== null && value.errorMessage !== null
  switch (value.state) {
    case "leased":
    case "running":
      if (hasLease && !hasError) return
      break
    case "failed":
      if (!hasLease && hasError) return
      break
    case "queued":
    case "succeeded":
    case "cancelled":
      if (!hasLease && !hasError) return
      break
  }
  context.addIssue({ code: "custom", message: "Durable job fields contradict state" })
}

export const DurableJobEventIdSchema = identifier<"DurableJobEventId">()
export const DurableJobIdempotencyKeySchema = identifier<"DurableJobIdempotencyKey">()
export const ProviderKindSchema = z.string().trim().min(1).brand<"ProviderKind">()
export const OutboundDisclosureIdSchema = identifier<"OutboundDisclosureId">()
export const RunnerRegistrationIdSchema = identifier<"RunnerRegistrationId">()
export const RunnerNameSchema = z.string().trim().min(1).brand<"RunnerName">()
export const DurableJobCreateSchema = z
  .object({
    id: DurableJobIdSchema,
    kind: z.string().trim().min(1),
    state: DurableJobStateSchema,
    idempotencyKey: DurableJobIdempotencyKeySchema,
    payload: JsonObjectSchema,
    leaseOwner: RunnerNameSchema.nullable().default(null),
    leaseExpiresAt: TimestampSchema.nullable().default(null),
    errorCode: SanitizedErrorCodeSchema.nullable().default(null),
    errorMessage: SanitizedErrorMessageSchema.nullable().default(null)
  })
  .strict()
  .superRefine((value, context) => {
    validateDurableState(value, context)
  })
export const DurableJobEventCreateSchema = z
  .object({
    id: DurableJobEventIdSchema,
    jobId: DurableJobIdSchema,
    kind: z.string().trim().min(1),
    payload: JsonObjectSchema
  })
  .strict()
export const ProviderSettingsUpsertSchema = z
  .object({
    providerKind: ProviderKindSchema,
    selectedModel: z.string().trim().min(1).nullable().default(null),
    enabled: z.boolean(),
    capabilities: CapabilitySchema,
    updatedAt: TimestampSchema
  })
  .strict()
export const OutboundDisclosureCreateSchema = z
  .object({
    id: OutboundDisclosureIdSchema,
    requestHash: HashSchema,
    providerKind: ProviderKindSchema,
    destination: z.string().url(),
    action: z.string().trim().min(1),
    actionAt: TimestampSchema,
    selectedInputHashes: z
      .array(HashSchema)
      .min(1)
      .superRefine((values, context) => {
        if (new Set(values).size !== values.length)
          context.addIssue({ code: "custom", message: "Selected input hashes must be unique" })
      })
  })
  .strict()
export const RunnerRegistrationUpsertSchema = z
  .object({
    id: RunnerRegistrationIdSchema,
    runnerName: RunnerNameSchema,
    tokenHash: HashSchema,
    capabilities: CapabilitySchema,
    status: RunnerRegistrationStatusSchema,
    registeredAt: TimestampSchema,
    lastSeenAt: TimestampSchema,
    revokedAt: TimestampSchema.nullable().default(null)
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.status === "revoked") !== (value.revokedAt !== null))
      context.addIssue({ code: "custom", message: "Runner revocation timestamp must match status" })
  })

export const DurableJobRowSchema = z
  .object({
    id: DurableJobIdSchema,
    kind: z.string().trim().min(1),
    state: DurableJobStateSchema,
    idempotencyKey: DurableJobIdempotencyKeySchema,
    payload: StoredJsonObjectSchema,
    leaseOwner: RunnerNameSchema.nullable(),
    leaseExpiresAt: TimestampSchema.nullable(),
    errorCode: SanitizedErrorCodeSchema.nullable(),
    errorMessage: SanitizedErrorMessageSchema.nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict()
  .superRefine((value, context) => {
    validateDurableState(value, context)
  })
export const DurableJobEventRowSchema = DurableJobEventCreateSchema.extend({
  payload: StoredJsonObjectSchema,
  sequence: z.number().int().positive(),
  createdAt: TimestampSchema
})
export const ProviderSettingsRowSchema = ProviderSettingsUpsertSchema.extend({
  capabilities: StoredJsonObjectSchema.pipe(CapabilitySchema),
  enabled: z.union([z.literal(0), z.literal(1)]).transform((value) => value === 1)
})
export const OutboundDisclosureRowSchema = z
  .object({
    id: OutboundDisclosureIdSchema,
    requestHash: HashSchema,
    providerKind: ProviderKindSchema,
    destination: z.string().url(),
    action: z.string().trim().min(1),
    actionAt: TimestampSchema,
    selectedInputHashes: StoredHashArraySchema
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.selectedInputHashes).size !== value.selectedInputHashes.length)
      context.addIssue({ code: "custom", message: "Selected input hashes must be unique" })
  })
export const RunnerRegistrationRowSchema = z
  .object({
    id: RunnerRegistrationIdSchema,
    runnerName: RunnerNameSchema,
    tokenHash: HashSchema,
    capabilities: StoredJsonObjectSchema.pipe(CapabilitySchema),
    status: RunnerRegistrationStatusSchema,
    registeredAt: TimestampSchema,
    lastSeenAt: TimestampSchema,
    revokedAt: TimestampSchema.nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.status === "revoked") !== (value.revokedAt !== null))
      context.addIssue({ code: "custom", message: "Runner revocation timestamp must match status" })
  })

export type DurableJob = z.output<typeof DurableJobRowSchema>
export type DurableJobEvent = z.output<typeof DurableJobEventRowSchema>
export type DurableJobIdempotencyKey = z.output<typeof DurableJobIdempotencyKeySchema>
export type ProviderSettings = z.output<typeof ProviderSettingsRowSchema>
export type ProviderKind = z.output<typeof ProviderKindSchema>
export type OutboundDisclosure = z.output<typeof OutboundDisclosureRowSchema>
export type OutboundDisclosureId = z.output<typeof OutboundDisclosureIdSchema>
export type RunnerRegistration = z.output<typeof RunnerRegistrationRowSchema>
export type RunnerName = z.output<typeof RunnerNameSchema>
