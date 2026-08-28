import type { Persistence } from "../db"
import { previewFile } from "../ingest/file-preview"
import { fetchPublicText, type PinnedTransport, type Resolver } from "../ingest/safe-fetcher"
import type { LocalSecuritySettings } from "../security/config"
import { ApplicationRepository } from "./repository"

type PostMetadata = {
  readonly title: string
  readonly companyName: string
  readonly teamName: string | null
  readonly location: string | null
  readonly employmentType: string | null
}

export class ApplicationService {
  readonly repository: ApplicationRepository
  constructor(
    private readonly persistence: Persistence,
    private readonly dataDirectory: string,
    private readonly limits: LocalSecuritySettings,
    private readonly resolver?: Resolver,
    private readonly transport?: PinnedTransport,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.repository = new ApplicationRepository(persistence.database)
  }

  async createManual(input: PostMetadata & { readonly text: string }) {
    return this.persistPost(input, "manual", input.text, null)
  }
  async createFile(input: PostMetadata & { readonly file: File }) {
    const extracted = await previewFile({
      dataDirectory: this.dataDirectory,
      file: input.file,
      limits: this.limits
    })
    return this.persistPost(input, "file", extracted.text, null)
  }
  async createUrl(input: PostMetadata & { readonly url: string }) {
    const fetched = await fetchPublicText({
      limits: this.limits,
      resolver: this.resolver,
      transport: this.transport,
      url: input.url
    })
    return this.persistPost(input, "url", fetched.text, fetched.url)
  }
  async addManualVersion(postId: string, text: string) {
    return this.persistVersion(postId, "manual", text)
  }
  async addFileVersion(postId: string, file: File) {
    const extracted = await previewFile({
      dataDirectory: this.dataDirectory,
      file,
      limits: this.limits
    })
    return this.persistVersion(postId, "file", extracted.text)
  }
  async addUrlVersion(postId: string, url: string) {
    const fetched = await fetchPublicText({
      limits: this.limits,
      resolver: this.resolver,
      transport: this.transport,
      url
    })
    return this.persistVersion(postId, "url", fetched.text, fetched.url)
  }
  private async persistPost(
    metadata: PostMetadata,
    sourceKind: "manual" | "file" | "url",
    text: string,
    canonicalUrl: string | null
  ) {
    const postId = crypto.randomUUID()
    const at = this.now()
    this.repository.createPost({
      id: postId,
      title: metadata.title,
      companyName: metadata.companyName,
      teamName: metadata.teamName,
      canonicalUrl,
      metadata: {
        location: metadata.location ?? null,
        employmentType: metadata.employmentType ?? null
      },
      createdAt: at
    })
    await this.persistVersion(postId, sourceKind, text, canonicalUrl)
    return this.repository.post(postId)
  }
  private async persistVersion(
    postId: string,
    sourceKind: "manual" | "file" | "url",
    text: string,
    sourceUrl: string | null = null
  ) {
    const normalized = text.trim()
    if (normalized.length === 0) throw new ApplicationServiceError("content_required")
    const blob = await this.persistence.blobs.put(
      new Blob([normalized]),
      "text/plain;charset=utf-8"
    )
    this.persistence.repositories.blobs.register(blob)
    this.repository.addPostVersion({
      id: crypto.randomUUID(),
      postId,
      sourceKind,
      bodyBlobHash: blob.sha256,
      content: { text: normalized, sourceUrl },
      createdAt: this.now()
    })
    return this.repository.post(postId)
  }
}

export class ApplicationServiceError extends Error {
  override readonly name = "ApplicationServiceError"
  constructor(readonly code: "content_required") {
    super(`APPLICATION_${code.toUpperCase()}`)
  }
}
