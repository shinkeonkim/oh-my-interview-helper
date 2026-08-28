import { z } from "zod"

import { DurableJobIdSchema } from "../db/ids"

export const JobStates = [
  "queued",
  "leased",
  "running",
  "succeeded",
  "failed",
  "cancelled"
] as const
export const JobStateSchema = z.enum(JobStates)
export type JobState = z.output<typeof JobStateSchema>
export const TerminalJobStates = ["succeeded", "failed", "cancelled"] as const
export const TerminalJobStateSchema = z.enum(TerminalJobStates)
export type TerminalJobState = z.output<typeof TerminalJobStateSchema>
export const isTerminalJobState = (value: string): value is TerminalJobState =>
  TerminalJobStateSchema.safeParse(value).success

export const RetryClasses = ["local", "external"] as const
export const RetryClassSchema = z.enum(RetryClasses)
export type RetryClass = z.output<typeof RetryClassSchema>
export const ExecutionTargets = ["app", "runner"] as const
export const ExecutionTargetSchema = z.enum(ExecutionTargets)
export type ExecutionTarget = z.output<typeof ExecutionTargetSchema>

const TimestampSchema = z.string().datetime()
const JobInputSchema = z.record(z.string(), z.json())
const ErrorCodeSchema = z
  .string()
  .regex(/^[a-z0-9_]+$/)
  .max(128)
const ErrorMessageSchema = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .regex(/^[\x20-\x7e]*$/)

export const containsSecretLikeData = (value: unknown): boolean => {
  if (typeof value === "string")
    return /(?:sk-|bearer\s+|api[_-]?key|token|secret|password|credential)/i.test(value)
  if (Array.isArray(value)) return value.some(containsSecretLikeData)
  if (typeof value !== "object" || value === null) return false
  return Object.entries(value).some(
    ([key, child]) =>
      /api[_-]?key|token|secret|password|credential|authorization|bearer/i.test(key) ||
      containsSecretLikeData(child)
  )
}

export class JobInputSecretError extends Error {
  override readonly name = "JobInputSecretError"

  constructor() {
    super("JOB_INPUT_SECRET_REJECTED")
  }
}

export const assertSecretFreeJobInput = (value: unknown): void => {
  if (containsSecretLikeData(value)) throw new JobInputSecretError()
}

export const CanonicalJobInputSchema = JobInputSchema.superRefine((value, context) => {
  if (containsSecretLikeData(value))
    context.addIssue({ code: "custom", message: "Job input cannot contain secrets" })
})
export type JobEventPayload = z.output<typeof CanonicalJobInputSchema>

const StoredJobInputSchema = z
  .string()
  .transform((value, context) => {
    try {
      return JSON.parse(value)
    } catch {
      context.addIssue({ code: "custom", message: "Job payload JSON is invalid" })
      return z.NEVER
    }
  })
  .pipe(CanonicalJobInputSchema)

export const JobSchema = z.object({
  id: DurableJobIdSchema,
  kind: z.string().trim().min(1),
  state: JobStateSchema,
  idempotencyKey: z.string().uuid(),
  payload: StoredJobInputSchema,
  retryClass: RetryClassSchema,
  executionTarget: ExecutionTargetSchema,
  attemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  nextAttemptAt: TimestampSchema.nullable(),
  cancellationRequestedAt: TimestampSchema.nullable(),
  leaseOwner: z.string().trim().min(1).nullable(),
  leaseExpiresAt: TimestampSchema.nullable(),
  errorCode: ErrorCodeSchema.nullable(),
  errorMessage: ErrorMessageSchema.nullable(),
  lastErrorCode: ErrorCodeSchema.nullable(),
  lastErrorMessage: ErrorMessageSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
})
export type Job = z.output<typeof JobSchema>

export const JobEventSchema = z.object({
  id: z.string().uuid(),
  jobId: DurableJobIdSchema,
  sequence: z.number().int().positive(),
  kind: z.string().trim().min(1),
  payload: StoredJobInputSchema,
  createdAt: TimestampSchema
})
export type JobEvent = z.output<typeof JobEventSchema>

export type JobEventReplay =
  | { readonly kind: "events"; readonly events: readonly JobEvent[] }
  | { readonly kind: "reset"; readonly code: "EVENT_REPLAY_GAP" }

export const EnqueueJobSchema = z.object({
  id: DurableJobIdSchema,
  kind: z.string().trim().min(1),
  input: CanonicalJobInputSchema,
  idempotencyKey: z.string().uuid(),
  retryClass: RetryClassSchema,
  executionTarget: ExecutionTargetSchema.default("app"),
  maxAttempts: z.number().int().positive(),
  now: TimestampSchema
})
export type EnqueueJob = z.output<typeof EnqueueJobSchema>

export class JobTransitionError extends Error {
  override readonly name = "JobTransitionError"

  constructor(readonly code: "JOB_NOT_CLAIMABLE" | "JOB_TRANSITION_INVALID" | "JOB_NOT_FOUND") {
    super(code)
  }
}

export class IdempotencyConflictError extends Error {
  override readonly name = "IdempotencyConflictError"

  constructor() {
    super("IDEMPOTENCY_CONFLICT")
  }
}

export class JobEventRetentionError extends Error {
  override readonly name = "JobEventRetentionError"

  constructor() {
    super("EVENT_RETENTION_INVALID")
  }
}

export class UnknownJobKindError extends Error {
  override readonly name = "UnknownJobKindError"

  constructor(readonly kind: string) {
    super("UNKNOWN_JOB_KIND")
  }
}

export const canonicalJson = (value: z.output<typeof CanonicalJobInputSchema>): string => {
  const serialize = (item: unknown): string => {
    if (item === null || typeof item !== "object") return JSON.stringify(item)
    if (Array.isArray(item)) return `[${item.map(serialize).join(",")}]`
    return `{${Object.entries(item)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${serialize(child)}`)
      .join(",")}}`
  }
  return serialize(value)
}
