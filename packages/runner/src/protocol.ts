import { z } from "zod"

export const RUNNER_PROTOCOL_VERSION = 1 as const
const IdSchema = z.string().uuid()
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const TimestampSchema = z.string().datetime()
const ProviderSchema = z.enum(["claude-cli", "codex-cli"])
const CapabilitiesSchema = z
  .object({
    claudeSubscription: z.boolean(),
    claudeDirectAuth: z.boolean(),
    claudeBare: z.boolean(),
    codexSkipGitRepoCheck: z.boolean(),
    claudeVersion: z.string().trim().min(1).max(128).nullable(),
    codexVersion: z.string().trim().min(1).max(128).nullable()
  })
  .strict()

export const PairRequestSchema = z
  .object({
    version: z.literal(RUNNER_PROTOCOL_VERSION),
    type: z.literal("pair_request"),
    runnerName: z.string().trim().min(1).max(128),
    pairingCode: z.string().regex(/^[A-Z0-9]{8}$/),
    capabilities: CapabilitiesSchema
  })
  .strict()
export const PairAcceptedSchema = z
  .object({
    version: z.literal(RUNNER_PROTOCOL_VERSION),
    type: z.literal("pair_accepted"),
    runnerId: IdSchema,
    token: z.string().min(32).max(512),
    expiresAt: TimestampSchema.nullable()
  })
  .strict()
export type PairAccepted = z.output<typeof PairAcceptedSchema>
export const AuthenticateSchema = z
  .object({
    version: z.literal(RUNNER_PROTOCOL_VERSION),
    type: z.literal("authenticate"),
    runnerId: IdSchema,
    token: z.string().min(32).max(512),
    nonce: z.string().min(16).max(128)
  })
  .strict()
export const ClaimSchema = z
  .object({
    version: z.literal(RUNNER_PROTOCOL_VERSION),
    type: z.literal("claim"),
    runId: IdSchema,
    leaseId: IdSchema,
    provider: ProviderSchema,
    model: z.string().trim().min(1).max(128),
    prompt: z.string().min(1).max(1_000_000),
    requestHash: HashSchema,
    deadline: TimestampSchema
  })
  .strict()
export const AckSchema = z
  .object({
    version: z.literal(RUNNER_PROTOCOL_VERSION),
    type: z.literal("ack"),
    runId: IdSchema,
    leaseId: IdSchema
  })
  .strict()
export const HeartbeatSchema = AckSchema.extend({ type: z.literal("heartbeat") }).strict()
export const OutputSchema = AckSchema.extend({
  type: z.literal("output"),
  sequence: z.number().int().positive(),
  stream: z.enum(["stdout", "stderr"]),
  chunk: z.string().max(65_536)
}).strict()
export const CompletionSchema = AckSchema.extend({
  type: z.literal("completion"),
  exitCode: z.literal(0),
  outputHash: HashSchema
}).strict()
export const FailureSchema = AckSchema.extend({
  type: z.literal("failure"),
  code: z.enum(["spawn_failed", "timeout", "cancelled", "output_limit", "cli_failed"]),
  retryable: z.boolean()
}).strict()
export const CancelSchema = AckSchema.extend({ type: z.literal("cancel") }).strict()

export const RunnerInboundMessageSchema = z.discriminatedUnion("type", [
  PairAcceptedSchema,
  ClaimSchema,
  CancelSchema
])
export const RunnerOutboundMessageSchema = z.discriminatedUnion("type", [
  PairRequestSchema,
  AuthenticateSchema,
  AckSchema,
  HeartbeatSchema,
  OutputSchema,
  CompletionSchema,
  FailureSchema
])

export type RunnerClaim = z.output<typeof ClaimSchema>
