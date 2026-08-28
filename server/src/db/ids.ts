import { z } from "zod"

const identifier = <Name extends string>() => z.string().uuid().brand<Name>()

export const DocumentIdSchema = identifier<"DocumentId">()
export const DocumentVersionIdSchema = identifier<"DocumentVersionId">()
export const JobPostIdSchema = identifier<"JobPostId">()
export const JobPostVersionIdSchema = identifier<"JobPostVersionId">()
export const ApplicationIdSchema = identifier<"ApplicationId">()
export const ApplicationEventIdSchema = identifier<"ApplicationEventId">()
export const ApplicationIdempotencyKeySchema = identifier<"ApplicationIdempotencyKey">()
export const ArtifactIdSchema = identifier<"ArtifactId">()
export const ResearchRecordIdSchema = identifier<"ResearchRecordId">()
export const ConversationIdSchema = identifier<"ConversationId">()
export const DurableJobIdSchema = identifier<"DurableJobId">()
export const ProviderRunIdSchema = identifier<"ProviderRunId">()

export type DocumentId = z.output<typeof DocumentIdSchema>
export type DocumentVersionId = z.output<typeof DocumentVersionIdSchema>
export type JobPostId = z.output<typeof JobPostIdSchema>
export type JobPostVersionId = z.output<typeof JobPostVersionIdSchema>
export type ApplicationId = z.output<typeof ApplicationIdSchema>
export type ApplicationEventId = z.output<typeof ApplicationEventIdSchema>
export type ApplicationIdempotencyKey = z.output<typeof ApplicationIdempotencyKeySchema>
export type ArtifactId = z.output<typeof ArtifactIdSchema>
export type ResearchRecordId = z.output<typeof ResearchRecordIdSchema>
export type ConversationId = z.output<typeof ConversationIdSchema>
export type DurableJobId = z.output<typeof DurableJobIdSchema>
export type ProviderRunId = z.output<typeof ProviderRunIdSchema>
