import type { Database } from "bun:sqlite"
import { z } from "zod"

import { DocumentIdSchema, DocumentVersionIdSchema, type DocumentId } from "./ids"
import type { BlobRecord, BlobStore } from "../storage/blob-store"
import { DomainRepository } from "./domain-repositories"
import { OperationsRepositories } from "./operations-repositories"
import { ProviderArtifactRepository } from "./provider-artifact-repositories"
import { ResearchConversationRepository } from "./research-conversation-repositories"
import { JobsRepository } from "../jobs/repository"

const TimestampSchema = z.string().datetime()
const BlobHashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const DocumentStateSchema = z.enum(["active", "archived", "deleted"])
export const DocumentCreateSchema = z.object({
  id: DocumentIdSchema,
  kind: z.enum(["resume", "portfolio", "cover_letter", "supporting"]),
  title: z.string().trim().min(1)
})
const VersionInputSchema = z.object({
  id: DocumentVersionIdSchema,
  documentId: DocumentIdSchema,
  blobHash: z.string().regex(/^[a-f0-9]{64}$/)
})
const DocumentRowSchema = DocumentCreateSchema.extend({
  state: DocumentStateSchema,
  created_at: TimestampSchema,
  current_version_id: DocumentVersionIdSchema.nullable(),
  version_id: DocumentVersionIdSchema.nullable(),
  blob_hash: z.string().nullable()
})

export type DocumentCreate = z.output<typeof DocumentCreateSchema>
export type Document = DocumentCreate & {
  readonly state: z.output<typeof DocumentStateSchema>
  readonly currentVersion: {
    readonly id: z.output<typeof DocumentVersionIdSchema>
    readonly blobHash: string
  } | null
}

const now = (): string => new Date().toISOString()
const mapDocument = (row: unknown): Document => {
  const value = DocumentRowSchema.parse(row)
  return {
    id: value.id,
    kind: value.kind,
    title: value.title,
    state: value.state,
    currentVersion:
      value.version_id === null || value.blob_hash === null
        ? null
        : { id: value.version_id, blobHash: value.blob_hash }
  }
}

export class DocumentRepository {
  constructor(private readonly database: Database) {}
  create(input: z.input<typeof DocumentCreateSchema>): Document {
    const document = DocumentCreateSchema.parse(input)
    this.database.run("INSERT INTO documents (id, kind, title, created_at) VALUES (?, ?, ?, ?)", [
      document.id,
      document.kind,
      document.title,
      now()
    ])
    return (
      this.get(document.id) ??
      (() => {
        throw new Error("document insert failed")
      })()
    )
  }
  get(id: DocumentId): Document | null {
    const row = this.database
      .query<unknown, [DocumentId]>(
        "SELECT d.id,d.kind,d.title,d.state,d.created_at,d.current_version_id,v.id version_id,v.blob_hash FROM documents d LEFT JOIN document_versions v ON v.id=d.current_version_id WHERE d.id=?"
      )
      .get(id)
    return row === null ? null : mapDocument(row)
  }
  list(): readonly Document[] {
    return this.database
      .query<unknown, []>(
        "SELECT d.id,d.kind,d.title,d.state,d.created_at,d.current_version_id,v.id version_id,v.blob_hash FROM documents d LEFT JOIN document_versions v ON v.id=d.current_version_id ORDER BY d.created_at DESC"
      )
      .all()
      .map(mapDocument)
  }
  addVersion(input: z.input<typeof VersionInputSchema>): void {
    const version = VersionInputSchema.parse(input)
    this.database
      .transaction(() => {
        const sequence = this.database
          .query<{ readonly sequence: number }, [DocumentId]>(
            "SELECT COALESCE(MAX(version_number),0)+1 sequence FROM document_versions WHERE document_id=?"
          )
          .get(version.documentId)
        const versionNumber = sequence?.sequence ?? 1
        this.database.run(
          "INSERT INTO document_versions (id,document_id,version_number,blob_hash,created_at) VALUES (?,?,?,?,?)",
          [version.id, version.documentId, versionNumber, version.blobHash, now()]
        )
        this.database.run("UPDATE documents SET current_version_id=? WHERE id=?", [
          version.id,
          version.documentId
        ])
      })
      .immediate()
  }
  logicalDelete(id: DocumentId): void {
    this.database.run("UPDATE documents SET state='deleted', deleted_at=? WHERE id=?", [now(), id])
  }
  archive(id: DocumentId): void {
    this.database.run("UPDATE documents SET state='archived', archived_at=? WHERE id=?", [
      now(),
      id
    ])
  }
}

export class BlobRepository {
  constructor(private readonly database: Database) {}
  register(blob: BlobRecord): void {
    const sha256 = BlobHashSchema.parse(blob.sha256)
    this.database.run(
      "INSERT OR IGNORE INTO blobs (sha256,byte_size,media_type,created_at) VALUES (?,?,?,?)",
      [sha256, blob.byteSize, blob.mediaType, now()]
    )
  }
  collectUnreferenced(
    storage: BlobStore,
    hooks: { readonly beforeClaim?: () => void; readonly candidates?: readonly string[] } = {}
  ): readonly string[] {
    const queried = this.database
      .query<{ readonly sha256: string }, []>(
        "SELECT b.sha256 FROM blobs b WHERE NOT EXISTS (SELECT 1 FROM document_versions WHERE blob_hash=b.sha256) AND NOT EXISTS (SELECT 1 FROM job_post_versions WHERE body_blob_hash=b.sha256) AND NOT EXISTS (SELECT 1 FROM artifacts WHERE body_blob_hash=b.sha256) AND NOT EXISTS (SELECT 1 FROM research_records WHERE content_blob_hash=b.sha256) AND NOT EXISTS (SELECT 1 FROM research_sources WHERE body_blob_hash=b.sha256) AND NOT EXISTS (SELECT 1 FROM messages WHERE body_blob_hash=b.sha256)"
      )
      .all()
      .map((row) => row.sha256)
    const candidates = hooks.candidates ?? queried
    const validatedHashes = candidates.map((hash) => BlobHashSchema.parse(hash))
    hooks.beforeClaim?.()
    const claimed = this.database
      .transaction(() =>
        validatedHashes.filter(
          (hash) =>
            this.database.run(
              "DELETE FROM blobs WHERE sha256=? AND NOT EXISTS (SELECT 1 FROM document_versions WHERE blob_hash=?) AND NOT EXISTS (SELECT 1 FROM job_post_versions WHERE body_blob_hash=?) AND NOT EXISTS (SELECT 1 FROM artifacts WHERE body_blob_hash=?) AND NOT EXISTS (SELECT 1 FROM research_records WHERE content_blob_hash=?) AND NOT EXISTS (SELECT 1 FROM research_sources WHERE body_blob_hash=?) AND NOT EXISTS (SELECT 1 FROM messages WHERE body_blob_hash=?)",
              [hash, hash, hash, hash, hash, hash, hash]
            ).changes === 1
        )
      )
      .immediate()
    for (const hash of claimed) storage.remove(hash)
    return claimed
  }
}

export class Repositories {
  readonly documents: DocumentRepository
  readonly blobs: BlobRepository
  readonly domain: DomainRepository
  readonly operations: OperationsRepositories
  readonly providerArtifacts: ProviderArtifactRepository
  readonly researchConversations: ResearchConversationRepository
  readonly jobs: JobsRepository
  constructor(readonly database: Database) {
    this.documents = new DocumentRepository(database)
    this.blobs = new BlobRepository(database)
    this.domain = new DomainRepository(database)
    this.operations = new OperationsRepositories(database)
    this.providerArtifacts = new ProviderArtifactRepository(database)
    this.researchConversations = new ResearchConversationRepository(database)
    this.jobs = new JobsRepository(database)
  }
  transaction<T>(action: () => T): T {
    return this.database.transaction(action).immediate()
  }
}
