import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

import {
  ConversationCreateSchema,
  MessageAppendSchema,
  ResearchConversationRepository,
  ResearchRecordCreateSchema,
  ResearchSourceCreateSchema
} from "../src/db/research-conversation-repositories"
import { createPersistence, type Persistence } from "../src/db/index"

const temporaryDirectories: string[] = []
const sourceHash = "a".repeat(64)
const makeDataDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-research-conversation-"))
  temporaryDirectories.push(directory)
  return directory
}
const createJobPost = (persistence: Persistence) =>
  persistence.repositories.domain.createJobPost({
    id: crypto.randomUUID(),
    title: "Engineer",
    companyName: "Example"
  })
const createApplication = (persistence: Persistence) => {
  const jobPost = createJobPost(persistence)
  return persistence.repositories.domain.createApplication({
    id: crypto.randomUUID(),
    jobPostId: jobPost.id,
    idempotencyKey: crypto.randomUUID()
  })
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { force: true, recursive: true })
})

describe("research and conversation repositories", () => {
  test("persists scoped research refresh lineage and source provenance", () => {
    // Given
    const persistence = createPersistence({ dataDirectory: makeDataDirectory() })
    const repository = new ResearchConversationRepository(persistence.database)
    const jobPost = createJobPost(persistence)
    const scope = { kind: "job_post" as const, jobPostId: jobPost.id }

    // When
    const stale = repository.createResearchRecord({
      id: crypto.randomUUID(),
      kind: "company",
      scope,
      status: "stale"
    })
    const active = repository.createResearchRecord({
      id: crypto.randomUUID(),
      kind: "company",
      scope
    })
    const source = repository.createResearchSource({
      id: crypto.randomUUID(),
      researchRecordId: active.id,
      canonicalUrl: "https://example.com/company",
      title: "Example company",
      contentHash: sourceHash,
      excerpt: "Public company information.",
      status: "available",
      retrievedAt: "2026-08-26T10:00:00.000Z"
    })

    // Then
    expect(repository.getResearchRecord(active.id)).toEqual(active)
    expect(repository.listResearchRecords(scope).map((record) => record.id)).toEqual([
      stale.id,
      active.id
    ])
    expect(repository.getResearchSource(source.id)).toEqual(source)
    expect(repository.listResearchSources(active.id)).toEqual([source])
    persistence.close()
  })

  test("rejects malformed research boundaries, duplicate canonical sources, and missing parents", () => {
    // Given
    const persistence = createPersistence({ dataDirectory: makeDataDirectory() })
    const repository = new ResearchConversationRepository(persistence.database)
    const record = repository.createResearchRecord({
      id: crypto.randomUUID(),
      kind: "company",
      scope: { kind: "global" }
    })
    const source = {
      id: crypto.randomUUID(),
      researchRecordId: record.id,
      canonicalUrl: "https://example.com/company",
      title: "Example company",
      contentHash: sourceHash,
      excerpt: "Public company information.",
      status: "available" as const,
      retrievedAt: "2026-08-26T10:00:00.000Z"
    }

    // When / Then
    expect(() => ResearchRecordCreateSchema.parse({ ...record, status: "unknown" })).toThrow(
      z.ZodError
    )
    expect(() =>
      ResearchSourceCreateSchema.parse({ ...source, canonicalUrl: "not-a-url" })
    ).toThrow(z.ZodError)
    expect(() => ResearchSourceCreateSchema.parse({ ...source, contentHash: "bad" })).toThrow(
      z.ZodError
    )
    repository.createResearchSource(source)
    expect(() => repository.createResearchSource({ ...source, id: crypto.randomUUID() })).toThrow()
    expect(() =>
      repository.createResearchSource({
        ...source,
        id: crypto.randomUUID(),
        researchRecordId: crypto.randomUUID()
      })
    ).toThrow()
    expect(() =>
      repository.createResearchRecord({
        id: crypto.randomUUID(),
        kind: "company",
        scope: { kind: "job_post", jobPostId: crypto.randomUUID() }
      })
    ).toThrow()
    persistence.close()
  })

  test("links conversations to applications and appends monotonic structured messages", () => {
    // Given
    const persistence = createPersistence({ dataDirectory: makeDataDirectory() })
    const repository = new ResearchConversationRepository(persistence.database)
    const application = createApplication(persistence)
    const conversation = repository.createConversation({
      id: crypto.randomUUID(),
      applicationId: application.id,
      title: "Interview practice"
    })

    // When
    const first = repository.appendMessage({
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: "user",
      content: { text: "Help me practice." }
    })
    const second = repository.appendMessage({
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: "assistant",
      content: { text: "Tell me about yourself.", citations: [] }
    })

    // Then
    expect(repository.getConversation(conversation.id)).toEqual(conversation)
    expect(repository.listConversations(application.id)).toEqual([conversation])
    expect(repository.listMessages(conversation.id)).toEqual([first, second])
    expect([first.sequence, second.sequence]).toEqual([1, 2])
    expect(() => MessageAppendSchema.parse({ ...first, role: "invalid" })).toThrow(z.ZodError)
    expect(() => MessageAppendSchema.parse({ ...first, content: { omitted: undefined } })).toThrow(
      z.ZodError
    )
    expect(() => repository.appendMessage({ ...first, id: first.id })).toThrow()
    expect(() =>
      persistence.database.run(
        "INSERT INTO messages (id,conversation_id,sequence,role,body,created_at) VALUES (?,?,?,?,?,?)",
        [crypto.randomUUID(), conversation.id, 1, "user", "{}", new Date().toISOString()]
      )
    ).toThrow()
    expect(() =>
      repository.appendMessage({
        id: crypto.randomUUID(),
        conversationId: crypto.randomUUID(),
        role: "user",
        content: { text: "missing parent" }
      })
    ).toThrow()
    expect(() =>
      repository.createConversation({
        id: crypto.randomUUID(),
        applicationId: crypto.randomUUID(),
        title: "Missing application"
      })
    ).toThrow()
    persistence.close()
  })

  test("rolls back composed writes and rejects malformed typed rows", () => {
    // Given
    const persistence = createPersistence({ dataDirectory: makeDataDirectory() })
    const repository = new ResearchConversationRepository(persistence.database)
    const recordId = crypto.randomUUID()
    const conversationId = crypto.randomUUID()

    // When / Then
    expect(() =>
      persistence.repositories.transaction(() => {
        repository.createResearchRecord({
          id: recordId,
          kind: "company",
          scope: { kind: "global" }
        })
        repository.createConversation({
          id: conversationId,
          applicationId: null,
          title: "Rollback"
        })
        throw new Error("rollback")
      })
    ).toThrow("rollback")
    expect(
      repository.getResearchRecord(
        ResearchRecordCreateSchema.parse({
          id: recordId,
          kind: "company",
          scope: { kind: "global" }
        }).id
      )
    ).toBeNull()
    expect(
      repository.getConversation(
        ConversationCreateSchema.parse({
          id: conversationId,
          applicationId: null,
          title: "Rollback"
        }).id
      )
    ).toBeNull()

    persistence.database.run("PRAGMA ignore_check_constraints = ON")
    persistence.database.run(
      "INSERT INTO research_records (id,kind,status,created_at) VALUES (?,?,?,?)",
      [crypto.randomUUID(), "company", "invalid", new Date().toISOString()]
    )
    expect(() => repository.listResearchRecords({ kind: "global" })).toThrow(z.ZodError)

    const record = repository.createResearchRecord({
      id: crypto.randomUUID(),
      kind: "company",
      scope: { kind: "global" }
    })
    persistence.database.run(
      "INSERT INTO research_sources (id,research_record_id,canonical_url,title,content_hash,excerpt,status,retrieved_at) VALUES (?,?,?,?,?,?,?,?)",
      [
        crypto.randomUUID(),
        record.id,
        "https://example.com/bad",
        "Bad",
        "bad",
        "Bad",
        "available",
        new Date().toISOString()
      ]
    )
    expect(() => repository.listResearchSources(record.id)).toThrow(z.ZodError)

    const conversation = repository.createConversation({
      id: crypto.randomUUID(),
      applicationId: null,
      title: "Malformed message"
    })
    persistence.database.run(
      "INSERT INTO messages (id,conversation_id,sequence,role,body,created_at) VALUES (?,?,?,?,?,?)",
      [crypto.randomUUID(), conversation.id, 1, "user", "not-json", new Date().toISOString()]
    )
    persistence.database.run("PRAGMA ignore_check_constraints = OFF")
    expect(() => repository.listMessages(conversation.id)).toThrow(z.ZodError)
    persistence.close()
  })
})
