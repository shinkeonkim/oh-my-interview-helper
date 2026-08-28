import { z } from "zod"

import {
  ApplicationIdSchema,
  ConversationIdSchema,
  JobPostIdSchema,
  ProviderRunIdSchema,
  ResearchRecordIdSchema,
  type JobPostId
} from "./ids"

const BlobHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .brand<"BlobHash">()
const TimestampSchema = z.string().datetime()
const JsonObjectSchema = z.record(z.string(), z.json())
const ResearchStatusSchema = z.enum(["active", "stale", "archived"])
const ResearchSourceStatusSchema = z.enum(["available", "failed", "archived"])
const MessageRoleSchema = z.enum(["system", "user", "assistant", "tool"])
const CanonicalUrlSchema = z.string().superRefine((value, context) => {
  try {
    const url = new URL(value)
    if ((url.protocol === "http:" || url.protocol === "https:") && url.href === value) return
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
  }
  context.addIssue({ code: "custom", message: "Expected a canonical HTTP URL" })
})
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

export const ResearchSourceIdSchema = z.string().uuid().brand<"ResearchSourceId">()
export const MessageIdSchema = z.string().uuid().brand<"MessageId">()
export const ResearchScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }),
  z.object({ kind: z.literal("job_post"), jobPostId: JobPostIdSchema })
])
export const ResearchRecordCreateSchema = z.object({
  id: ResearchRecordIdSchema,
  kind: z.string().trim().min(1),
  scope: ResearchScopeSchema,
  status: ResearchStatusSchema.default("active"),
  contentBlobHash: BlobHashSchema.nullable().default(null)
})
export const ResearchSourceCreateSchema = z.object({
  id: ResearchSourceIdSchema,
  researchRecordId: ResearchRecordIdSchema,
  canonicalUrl: CanonicalUrlSchema,
  title: z.string().trim().min(1),
  contentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .brand<"ResearchContentHash">(),
  excerpt: z.string(),
  status: ResearchSourceStatusSchema,
  bodyBlobHash: BlobHashSchema.nullable().default(null),
  retrievedAt: TimestampSchema
})
export const ConversationCreateSchema = z.object({
  id: ConversationIdSchema,
  applicationId: ApplicationIdSchema.nullable().default(null),
  title: z.string().trim().min(1)
})
export const MessageAppendSchema = z.object({
  id: MessageIdSchema,
  conversationId: ConversationIdSchema,
  role: MessageRoleSchema,
  content: JsonObjectSchema,
  bodyBlobHash: BlobHashSchema.nullable().default(null),
  providerRunId: ProviderRunIdSchema.nullable().default(null)
})

const ResearchRecordRowSchema = z.object({
  id: ResearchRecordIdSchema,
  jobPostId: JobPostIdSchema.nullable(),
  kind: z.string().trim().min(1),
  status: ResearchStatusSchema,
  contentBlobHash: BlobHashSchema.nullable(),
  createdAt: TimestampSchema,
  archivedAt: TimestampSchema.nullable()
})
const ResearchSourceRowSchema = ResearchSourceCreateSchema
const ConversationRowSchema = ConversationCreateSchema.extend({
  createdAt: TimestampSchema,
  archivedAt: TimestampSchema.nullable()
})
const MessageRowSchema = MessageAppendSchema.omit({ content: true }).extend({
  sequence: z.number().int().positive(),
  body: StoredJsonObjectSchema,
  createdAt: TimestampSchema
})

export type ResearchScope = z.output<typeof ResearchScopeSchema>
export type ResearchRecord = z.output<typeof ResearchRecordCreateSchema> & {
  readonly createdAt: string
  readonly archivedAt: string | null
}
export type ResearchSource = z.output<typeof ResearchSourceCreateSchema>
export type Conversation = z.output<typeof ConversationCreateSchema> & {
  readonly createdAt: string
  readonly archivedAt: string | null
}
export type Message = z.output<typeof MessageAppendSchema> & {
  readonly sequence: number
  readonly createdAt: string
}
export type ResearchSourceId = z.output<typeof ResearchSourceIdSchema>

const assertNever = (value: never): never => {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`)
}

export const jobPostIdForScope = (scope: ResearchScope): JobPostId | null => {
  switch (scope.kind) {
    case "global":
      return null
    case "job_post":
      return scope.jobPostId
    default:
      return assertNever(scope)
  }
}
export const mapResearchRecord = (row: unknown): ResearchRecord => {
  const value = ResearchRecordRowSchema.parse(row)
  return {
    id: value.id,
    kind: value.kind,
    scope:
      value.jobPostId === null
        ? { kind: "global" }
        : { kind: "job_post", jobPostId: value.jobPostId },
    status: value.status,
    contentBlobHash: value.contentBlobHash,
    createdAt: value.createdAt,
    archivedAt: value.archivedAt
  }
}
export const mapResearchSource = (row: unknown): ResearchSource =>
  ResearchSourceRowSchema.parse(row)
export const mapConversation = (row: unknown): Conversation => ConversationRowSchema.parse(row)
export const mapMessage = (row: unknown): Message => {
  const value = MessageRowSchema.parse(row)
  return {
    id: value.id,
    conversationId: value.conversationId,
    role: value.role,
    content: value.body,
    bodyBlobHash: value.bodyBlobHash,
    providerRunId: value.providerRunId,
    sequence: value.sequence,
    createdAt: value.createdAt
  }
}
