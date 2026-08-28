import type { Persistence } from "../db"
import { previewFile, type FilePreview } from "../ingest/file-preview"
import type { LocalSecuritySettings } from "../security/config"
import type { BlobRecord } from "../storage/blob-store"
import {
  DocumentKindSchema,
  DocumentLibraryError,
  DocumentLibraryRepository,
  type DocumentKind
} from "./repository"

export class DocumentLibraryService {
  readonly repository: DocumentLibraryRepository

  constructor(
    private readonly persistence: Persistence,
    private readonly dataDirectory: string,
    private readonly limits: LocalSecuritySettings,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.repository = new DocumentLibraryRepository(persistence.database)
  }

  list() {
    return this.repository.list()
  }

  get(id: string) {
    return this.repository.get(id)
  }

  async upload(input: {
    readonly file: File
    readonly kind: DocumentKind
    readonly title?: string
    readonly documentId?: string
  }) {
    if (input.documentId !== undefined) {
      const document = this.repository.get(input.documentId)
      if (document === null || document.state !== "active")
        throw new DocumentLibraryError("document_unavailable")
    }
    const extracted = await this.extract(input.file)
    const blob = await this.persistence.blobs.put(input.file, input.file.type)
    this.persistence.repositories.blobs.register(blob)
    return this.persistence.repositories.transaction(() => this.persist(input, extracted, blob))
  }

  async uploadMany(files: readonly File[], kind: DocumentKind) {
    const extracted = await Promise.all(files.map((file) => this.extract(file)))
    const blobs: BlobRecord[] = []
    for (const file of files) {
      const blob = await this.persistence.blobs.put(file, file.type)
      this.persistence.repositories.blobs.register(blob)
      blobs.push(blob)
    }
    return this.persistence.repositories.transaction(() =>
      files.map((file, index) =>
        this.persist(
          { file, kind },
          extracted[index] ??
            (() => {
              throw new DocumentServiceError("preview_unavailable")
            })(),
          blobs[index] ??
            (() => {
              throw new DocumentServiceError("preview_unavailable")
            })()
        )
      )
    )
  }

  private extract(file: File) {
    return previewFile({
      dataDirectory: this.dataDirectory,
      file,
      limits: this.limits
    })
  }

  private persist(
    input: {
      readonly file: File
      readonly kind: DocumentKind
      readonly title?: string
      readonly documentId?: string
    },
    extracted: FilePreview,
    blob: BlobRecord
  ) {
    const documentId = input.documentId ?? crypto.randomUUID()
    if (input.documentId === undefined)
      this.repository.create({
        id: documentId,
        kind: DocumentKindSchema.parse(input.kind),
        title: input.title?.trim() || extracted.displayName.replace(/\.[^.]+$/, ""),
        createdAt: this.now()
      })
    this.repository.addVersion({
      id: crypto.randomUUID(),
      documentId,
      blobHash: blob.sha256,
      displayName: extracted.displayName,
      mediaType: input.file.type,
      byteSize: blob.byteSize,
      extractedText: extracted.text,
      createdAt: this.now()
    })
    return this.repository.get(documentId)
  }

  async manual(input: {
    readonly kind: DocumentKind
    readonly title: string
    readonly text: string
  }) {
    const text = input.text.trim()
    if (text.length === 0) throw new DocumentServiceError("text_required")
    const file = new File([text], `${input.title.trim()}.txt`, { type: "text/plain" })
    return this.upload({ file, kind: input.kind, title: input.title })
  }

  versions(id: string) {
    this.require(id)
    return this.repository.versions(id).map((stored) => {
      const { extractedText, ...version } = stored
      void extractedText
      return version
    })
  }

  preview(id: string) {
    const document = this.require(id)
    const version = this.repository.currentVersion(id)
    if (version === null || version.extractedText === null)
      throw new DocumentServiceError("preview_unavailable")
    return {
      documentId: document.id,
      versionId: version.id,
      title: document.title,
      text: version.extractedText
    }
  }

  download(id: string): {
    readonly file: Bun.BunFile
    readonly name: string
    readonly mediaType: string
  } {
    const document = this.require(id)
    const version = this.repository.currentVersion(id)
    if (version === null) throw new DocumentServiceError("download_unavailable")
    return {
      file: Bun.file(this.persistence.blobs.pathFor(version.blobHash)),
      name: version.displayName ?? `${document.title}.txt`,
      mediaType: version.mediaType ?? "application/octet-stream"
    }
  }

  selectedContext() {
    return this.repository
      .list()
      .filter((document) => document.selected && document.state === "active")
      .flatMap((document) => {
        const version = this.repository.currentVersion(document.id)
        return version?.extractedText === null || version?.extractedText === undefined
          ? []
          : [
              {
                documentId: document.id,
                versionId: version.id,
                kind: document.kind,
                title: document.title,
                text: version.extractedText
              }
            ]
      })
  }

  private require(id: string) {
    const document = this.repository.get(id)
    if (document === null || document.state === "deleted")
      throw new DocumentServiceError("not_found")
    return document
  }
}

export class DocumentServiceError extends Error {
  override readonly name = "DocumentServiceError"
  constructor(
    readonly code: "download_unavailable" | "not_found" | "preview_unavailable" | "text_required"
  ) {
    super(`DOCUMENT_${code.toUpperCase()}`)
  }
}
