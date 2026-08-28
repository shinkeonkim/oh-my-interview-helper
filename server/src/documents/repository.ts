import type { Database } from "bun:sqlite"
import { z } from "zod"

import { DocumentIdSchema, DocumentVersionIdSchema } from "../db/ids"

export const DocumentKindSchema = z.enum(["resume", "portfolio", "cover_letter", "supporting"])
export const DocumentStateSchema = z.enum(["active", "archived", "deleted"])
const TimestampSchema = z.string().datetime()
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/)

const DocumentSummaryRowSchema = z.object({
  id: DocumentIdSchema,
  kind: DocumentKindSchema,
  title: z.string(),
  state: DocumentStateSchema,
  createdAt: TimestampSchema,
  selected: z.union([z.literal(0), z.literal(1)]).transform(Boolean),
  currentVersionId: DocumentVersionIdSchema.nullable(),
  versionNumber: z.number().int().positive().nullable(),
  displayName: z.string().nullable(),
  mediaType: z.string().nullable(),
  byteSize: z.number().int().nonnegative().nullable(),
  extractionStatus: z.enum(["completed", "failed"]).nullable(),
  extractionError: z.string().nullable(),
  usageCount: z.number().int().nonnegative()
})

const VersionRowSchema = z.object({
  id: DocumentVersionIdSchema,
  documentId: DocumentIdSchema,
  versionNumber: z.number().int().positive(),
  blobHash: HashSchema,
  createdAt: TimestampSchema,
  displayName: z.string().nullable(),
  mediaType: z.string().nullable(),
  byteSize: z.number().int().nonnegative().nullable(),
  extractionStatus: z.enum(["completed", "failed"]),
  extractionError: z.string().nullable(),
  extractedText: z.string().nullable()
})

export type DocumentSummary = z.output<typeof DocumentSummaryRowSchema>
export type DocumentVersion = z.output<typeof VersionRowSchema>
export type DocumentKind = z.output<typeof DocumentKindSchema>

const summarySql = `SELECT d.id,d.kind,d.title,d.state,d.created_at createdAt,
  CASE WHEN s.document_id IS NULL THEN 0 ELSE 1 END selected,
  d.current_version_id currentVersionId,v.version_number versionNumber,v.display_name displayName,
  v.media_type mediaType,v.byte_size byteSize,v.extraction_status extractionStatus,
  v.extraction_error extractionError,
  (SELECT count(*) FROM artifact_inputs ai WHERE ai.document_version_id IN
    (SELECT id FROM document_versions WHERE document_id=d.id)) usageCount
  FROM documents d
  LEFT JOIN document_versions v ON v.id=d.current_version_id
  LEFT JOIN profile_document_selections s ON s.document_id=d.id`

export class DocumentLibraryRepository {
  constructor(private readonly database: Database) {}

  list(includeDeleted = false): readonly DocumentSummary[] {
    return this.database
      .query<unknown, []>(
        `${summarySql}${includeDeleted ? "" : " WHERE d.state!='deleted'"} ORDER BY d.created_at DESC,d.id`
      )
      .all()
      .map((row) => DocumentSummaryRowSchema.parse(row))
  }

  get(id: string): DocumentSummary | null {
    const parsedId = DocumentIdSchema.parse(id)
    const row = this.database.query<unknown, [string]>(`${summarySql} WHERE d.id=?`).get(parsedId)
    return row === null ? null : DocumentSummaryRowSchema.parse(row)
  }

  create(input: {
    readonly id: string
    readonly kind: DocumentKind
    readonly title: string
    readonly createdAt: string
  }): void {
    this.database.run("INSERT INTO documents (id,kind,title,created_at) VALUES (?,?,?,?)", [
      DocumentIdSchema.parse(input.id),
      DocumentKindSchema.parse(input.kind),
      z.string().trim().min(1).max(200).parse(input.title),
      TimestampSchema.parse(input.createdAt)
    ])
  }

  addVersion(input: {
    readonly id: string
    readonly documentId: string
    readonly blobHash: string
    readonly displayName: string
    readonly mediaType: string
    readonly byteSize: number
    readonly extractedText: string
    readonly createdAt: string
  }): void {
    const documentId = DocumentIdSchema.parse(input.documentId)
    const versionId = DocumentVersionIdSchema.parse(input.id)
    this.database
      .transaction(() => {
        const sequence =
          this.database
            .query<{ sequence: number }, [string]>(
              "SELECT COALESCE(MAX(version_number),0)+1 sequence FROM document_versions WHERE document_id=?"
            )
            .get(documentId)?.sequence ?? 1
        this.database.run(
          "INSERT INTO document_versions (id,document_id,version_number,blob_hash,created_at,display_name,media_type,byte_size,extraction_status,extracted_text) VALUES (?,?,?,?,?,?,?,?,?,?)",
          [
            versionId,
            documentId,
            sequence,
            HashSchema.parse(input.blobHash),
            TimestampSchema.parse(input.createdAt),
            z.string().min(1).max(120).parse(input.displayName),
            z.string().min(1).max(200).parse(input.mediaType),
            z.number().int().nonnegative().parse(input.byteSize),
            "completed",
            input.extractedText
          ]
        )
        this.database.run(
          "UPDATE documents SET current_version_id=? WHERE id=? AND state='active'",
          [versionId, documentId]
        )
        if (
          this.database
            .query<{ id: string }, [string, string]>(
              "SELECT id FROM documents WHERE id=? AND current_version_id=?"
            )
            .get(documentId, versionId) === null
        )
          throw new DocumentLibraryError("document_unavailable")
      })
      .immediate()
  }

  versions(documentId: string): readonly DocumentVersion[] {
    return this.database
      .query<unknown, [string]>(
        "SELECT id,document_id documentId,version_number versionNumber,blob_hash blobHash,created_at createdAt,display_name displayName,media_type mediaType,byte_size byteSize,extraction_status extractionStatus,extraction_error extractionError,extracted_text extractedText FROM document_versions WHERE document_id=? ORDER BY version_number DESC"
      )
      .all(DocumentIdSchema.parse(documentId))
      .map((row) => VersionRowSchema.parse(row))
  }

  currentVersion(documentId: string): DocumentVersion | null {
    return (
      this.versions(documentId).find(
        (version) => version.id === this.get(documentId)?.currentVersionId
      ) ?? null
    )
  }

  select(documentId: string, selected: boolean, selectedAt: string): void {
    const id = DocumentIdSchema.parse(documentId)
    const document = this.get(id)
    if (document === null || document.state !== "active")
      throw new DocumentLibraryError("document_unavailable")
    if (selected)
      this.database.run(
        "INSERT OR REPLACE INTO profile_document_selections (document_id,selected_at) VALUES (?,?)",
        [id, TimestampSchema.parse(selectedAt)]
      )
    else this.database.run("DELETE FROM profile_document_selections WHERE document_id=?", [id])
  }

  transition(documentId: string, state: "archived" | "deleted", at: string): void {
    const id = DocumentIdSchema.parse(documentId)
    this.database
      .transaction(() => {
        this.database.run("DELETE FROM profile_document_selections WHERE document_id=?", [id])
        const column = state === "archived" ? "archived_at" : "deleted_at"
        const changed = this.database.run(
          `UPDATE documents SET state=?,${column}=? WHERE id=? AND state='active'`,
          [state, TimestampSchema.parse(at), id]
        ).changes
        if (changed !== 1) throw new DocumentLibraryError("document_unavailable")
      })
      .immediate()
  }
}

export class DocumentLibraryError extends Error {
  override readonly name = "DocumentLibraryError"
  constructor(readonly code: "document_unavailable") {
    super(`DOCUMENT_LIBRARY_${code.toUpperCase()}`)
  }
}
