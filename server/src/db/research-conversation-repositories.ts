import type { Database } from "bun:sqlite"
import type { z } from "zod"

import {
  ConversationCreateSchema,
  type Conversation,
  type Message,
  MessageAppendSchema,
  mapConversation,
  mapMessage,
  mapResearchRecord,
  mapResearchSource,
  jobPostIdForScope,
  ResearchRecordCreateSchema,
  type ResearchRecord,
  type ResearchScope,
  ResearchSourceCreateSchema,
  type ResearchSource,
  type ResearchSourceId
} from "./research-conversation-types"
import type { ApplicationId, ConversationId, ResearchRecordId } from "./ids"

export {
  ConversationCreateSchema,
  MessageAppendSchema,
  ResearchRecordCreateSchema,
  ResearchScopeSchema,
  ResearchSourceCreateSchema,
  ResearchSourceIdSchema,
  MessageIdSchema
} from "./research-conversation-types"
export type {
  Conversation,
  Message,
  ResearchRecord,
  ResearchScope,
  ResearchSource,
  ResearchSourceId
} from "./research-conversation-types"

const now = (): string => new Date().toISOString()

export class ResearchConversationRepository {
  constructor(private readonly database: Database) {}

  createResearchRecord(input: z.input<typeof ResearchRecordCreateSchema>): ResearchRecord {
    const record = ResearchRecordCreateSchema.parse(input)
    const createdAt = now()
    this.database.run(
      "INSERT INTO research_records (id,job_post_id,kind,status,content_blob_hash,created_at) VALUES (?,?,?,?,?,?)",
      [
        record.id,
        jobPostIdForScope(record.scope),
        record.kind,
        record.status,
        record.contentBlobHash,
        createdAt
      ]
    )
    return { ...record, createdAt, archivedAt: null }
  }

  getResearchRecord(id: ResearchRecordId): ResearchRecord | null {
    const row = this.database
      .query<unknown, [ResearchRecordId]>(
        "SELECT id,job_post_id jobPostId,kind,status,content_blob_hash contentBlobHash,created_at createdAt,archived_at archivedAt FROM research_records WHERE id=?"
      )
      .get(id)
    return row === null ? null : mapResearchRecord(row)
  }

  listResearchRecords(scope: ResearchScope): readonly ResearchRecord[] {
    switch (scope.kind) {
      case "global":
        return this.database
          .query<unknown, []>(
            "SELECT id,job_post_id jobPostId,kind,status,content_blob_hash contentBlobHash,created_at createdAt,archived_at archivedAt FROM research_records WHERE job_post_id IS NULL ORDER BY created_at,rowid"
          )
          .all()
          .map(mapResearchRecord)
      case "job_post":
        return this.database
          .query<unknown, [string]>(
            "SELECT id,job_post_id jobPostId,kind,status,content_blob_hash contentBlobHash,created_at createdAt,archived_at archivedAt FROM research_records WHERE job_post_id=? ORDER BY created_at,rowid"
          )
          .all(scope.jobPostId)
          .map(mapResearchRecord)
    }
  }

  createResearchSource(input: z.input<typeof ResearchSourceCreateSchema>): ResearchSource {
    const source = ResearchSourceCreateSchema.parse(input)
    this.database.run(
      "INSERT INTO research_sources (id,research_record_id,canonical_url,title,content_hash,excerpt,status,body_blob_hash,retrieved_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [
        source.id,
        source.researchRecordId,
        source.canonicalUrl,
        source.title,
        source.contentHash,
        source.excerpt,
        source.status,
        source.bodyBlobHash,
        source.retrievedAt
      ]
    )
    return source
  }

  getResearchSource(id: ResearchSourceId): ResearchSource | null {
    const row = this.database
      .query<unknown, [ResearchSourceId]>(
        "SELECT id,research_record_id researchRecordId,canonical_url canonicalUrl,title,content_hash contentHash,excerpt,status,body_blob_hash bodyBlobHash,retrieved_at retrievedAt FROM research_sources WHERE id=?"
      )
      .get(id)
    return row === null ? null : mapResearchSource(row)
  }

  listResearchSources(researchRecordId: ResearchRecordId): readonly ResearchSource[] {
    return this.database
      .query<unknown, [ResearchRecordId]>(
        "SELECT id,research_record_id researchRecordId,canonical_url canonicalUrl,title,content_hash contentHash,excerpt,status,body_blob_hash bodyBlobHash,retrieved_at retrievedAt FROM research_sources WHERE research_record_id=? ORDER BY retrieved_at DESC,rowid DESC"
      )
      .all(researchRecordId)
      .map(mapResearchSource)
  }

  createConversation(input: z.input<typeof ConversationCreateSchema>): Conversation {
    const conversation = ConversationCreateSchema.parse(input)
    const createdAt = now()
    this.database.run(
      "INSERT INTO conversations (id,application_id,title,created_at) VALUES (?,?,?,?)",
      [conversation.id, conversation.applicationId, conversation.title, createdAt]
    )
    return { ...conversation, createdAt, archivedAt: null }
  }

  getConversation(id: ConversationId): Conversation | null {
    const row = this.database
      .query<unknown, [ConversationId]>(
        "SELECT id,application_id applicationId,title,created_at createdAt,archived_at archivedAt FROM conversations WHERE id=?"
      )
      .get(id)
    return row === null ? null : mapConversation(row)
  }

  listConversations(applicationId: ApplicationId | null): readonly Conversation[] {
    const query =
      "SELECT id,application_id applicationId,title,created_at createdAt,archived_at archivedAt FROM conversations"
    const rows =
      applicationId === null
        ? this.database
            .query<unknown, []>(
              `${query} WHERE application_id IS NULL ORDER BY created_at DESC,rowid DESC`
            )
            .all()
        : this.database
            .query<unknown, [ApplicationId]>(
              `${query} WHERE application_id=? ORDER BY created_at DESC,rowid DESC`
            )
            .all(applicationId)
    return rows.map(mapConversation)
  }

  appendMessage(input: z.input<typeof MessageAppendSchema>): Message {
    const message = MessageAppendSchema.parse(input)
    return this.database
      .transaction(() => {
        const sequence =
          this.database
            .query<{ readonly sequence: number }, [ConversationId]>(
              "SELECT COALESCE(MAX(sequence),0)+1 sequence FROM messages WHERE conversation_id=?"
            )
            .get(message.conversationId)?.sequence ?? 1
        const createdAt = now()
        this.database.run(
          "INSERT INTO messages (id,conversation_id,sequence,role,body,body_blob_hash,provider_run_id,created_at) VALUES (?,?,?,?,?,?,?,?)",
          [
            message.id,
            message.conversationId,
            sequence,
            message.role,
            JSON.stringify(message.content),
            message.bodyBlobHash,
            message.providerRunId,
            createdAt
          ]
        )
        return { ...message, sequence, createdAt }
      })
      .immediate()
  }

  listMessages(conversationId: ConversationId): readonly Message[] {
    return this.database
      .query<unknown, [ConversationId]>(
        "SELECT id,conversation_id conversationId,sequence,role,body,body_blob_hash bodyBlobHash,provider_run_id providerRunId,created_at createdAt FROM messages WHERE conversation_id=? ORDER BY sequence"
      )
      .all(conversationId)
      .map(mapMessage)
  }
}
