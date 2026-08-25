import { z } from "zod"

import { DurableJobIdSchema } from "./ids"
import {
  CanonicalJobInputSchema,
  ExecutionTargetSchema,
  JobEventSchema,
  JobSchema,
  RetryClassSchema,
  containsSecretLikeData,
  isTerminalJobState,
  type Job,
  type JobEvent
} from "../jobs/types"

const identifier = <Name extends string>() => z.string().uuid().brand<Name>()
const TimestampSchema = z.string().datetime()
const JsonObjectSchema = z.record(z.string(), z.json())
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
const HashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .brand<"OperationHash">()
const RunnerRegistrationStatusSchema = z.enum(["active", "revoked"])
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
const CapabilitySchema = JsonObjectSchema.superRefine((value, context) => {
  if (containsSecretLikeData(value))
    context.addIssue({ code: "custom", message: "Provider capabilities cannot contain secrets" })
})
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
    state: z.literal("queued"),
    idempotencyKey: DurableJobIdempotencyKeySchema,
    payload: CanonicalJobInputSchema,
    retryClass: RetryClassSchema,
    executionTarget: ExecutionTargetSchema,
    maxAttempts: z.number().int().positive()
  })
  .strict()
export const DurableJobEventCreateSchema = z
  .object({
    id: DurableJobEventIdSchema,
    jobId: DurableJobIdSchema,
    kind: z
      .string()
      .trim()
      .min(1)
      .refine((kind) => !isTerminalJobState(kind), "Terminal events require the job state machine"),
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

export const DurableJobRowSchema = JobSchema
export const DurableJobEventRowSchema = JobEventSchema
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

export type DurableJob = Job
export type DurableJobEvent = JobEvent
export type DurableJobIdempotencyKey = z.output<typeof DurableJobIdempotencyKeySchema>
export type ProviderSettings = z.output<typeof ProviderSettingsRowSchema>
export type ProviderKind = z.output<typeof ProviderKindSchema>
export type OutboundDisclosure = z.output<typeof OutboundDisclosureRowSchema>
export type OutboundDisclosureId = z.output<typeof OutboundDisclosureIdSchema>
export type RunnerRegistration = z.output<typeof RunnerRegistrationRowSchema>
export type RunnerName = z.output<typeof RunnerNameSchema>
