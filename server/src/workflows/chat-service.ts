import { z } from "zod"

import type { ResearchConversationRepository } from "../db/research-conversation-repositories"
import { ApplicationIdSchema, ConversationIdSchema } from "../db/ids"
import { DisclosureInputRefSchema, type DisclosureInputRef } from "../disclosures/sources"
import { DisclosureSourceResolver } from "../disclosures/sources"
import type { Database } from "bun:sqlite"

export const ChatRequestSchema = z
  .object({
    conversationId: ConversationIdSchema.nullable().default(null),
    applicationId: ApplicationIdSchema,
    title: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(20_000),
    providerId: z.string().trim().min(1).max(64),
    disclosureId: z.string().uuid(),
    inputs: z.array(DisclosureInputRefSchema).min(1).max(30)
  })
  .strict()
export const ChatDisclosureRequestSchema = ChatRequestSchema.omit({ disclosureId: true }).strict()
export const ChatOutputSchema = z
  .object({
    answer: z.string().trim().min(1).max(40_000),
    citations: z
      .array(
        z.object({ sourceId: z.string().uuid(), note: z.string().trim().min(1).max(500) }).strict()
      )
      .max(30)
  })
  .strict()

export type ChatExecutor = {
  readonly execute: (input: {
    readonly conversationId: string | null
    readonly applicationId: string
    readonly message: string
    readonly providerId: string
    readonly disclosureId: string
    readonly inputs: readonly DisclosureInputRef[]
    readonly signal: AbortSignal
  }) => Promise<{ readonly output: unknown; readonly providerRunId: string }>
}

export class ChatWorkflowService {
  private readonly sources: DisclosureSourceResolver
  constructor(
    private readonly repository: ResearchConversationRepository,
    private readonly executor: ChatExecutor,
    database: Database
  ) {
    this.sources = new DisclosureSourceResolver(database)
  }

  async send(raw: unknown, signal: AbortSignal) {
    const request = ChatRequestSchema.parse(raw)
    const existing =
      request.conversationId === null
        ? null
        : this.repository.getConversation(request.conversationId)
    if (
      request.conversationId !== null &&
      (existing === null ||
        existing.archivedAt !== null ||
        existing.applicationId !== request.applicationId)
    )
      throw new ChatWorkflowError("conversation_unavailable")
    for (const input of request.inputs) this.sources.resolve(input)
    const execution = await this.executor.execute({
      conversationId: request.conversationId,
      applicationId: request.applicationId,
      message: request.message,
      providerId: request.providerId,
      disclosureId: request.disclosureId,
      inputs: request.inputs,
      signal
    })
    if (signal.aborted) throw new ChatWorkflowError("cancelled")
    const output = ChatOutputSchema.parse(execution.output)
    const allowed = new Set(request.inputs.map(referenceId))
    if (output.citations.some((citation) => !allowed.has(citation.sourceId)))
      throw new ChatWorkflowError("citation_missing")
    const conversation =
      existing ??
      this.repository.createConversation({
        id: crypto.randomUUID(),
        applicationId: request.applicationId,
        title: request.title
      })
    const user = this.repository.appendMessage({
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: "user",
      content: { text: request.message, inputRefs: request.inputs },
      bodyBlobHash: null,
      providerRunId: null
    })
    const assistant = this.repository.appendMessage({
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: "assistant",
      content: output,
      bodyBlobHash: null,
      providerRunId: execution.providerRunId
    })
    return { conversation, messages: [user, assistant] }
  }

  list(applicationId: string) {
    return this.repository.listConversations(ApplicationIdSchema.parse(applicationId))
  }

  messages(conversationId: string) {
    return this.repository.listMessages(ConversationIdSchema.parse(conversationId))
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

export class ChatWorkflowError extends Error {
  override readonly name = "ChatWorkflowError"
  constructor(readonly code: "conversation_unavailable" | "citation_missing" | "cancelled") {
    super(`CHAT_${code.toUpperCase()}`)
  }
}

export const unavailableChatExecutor: ChatExecutor = {
  execute: async () => {
    throw new ChatExecutorError("unavailable")
  }
}

export class ChatExecutorError extends Error {
  override readonly name = "ChatExecutorError"
  constructor(readonly code: "unavailable" | "provider_failed") {
    super(`CHAT_EXECUTOR_${code.toUpperCase()}`)
  }
}
