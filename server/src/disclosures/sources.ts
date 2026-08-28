import { createHash } from "node:crypto"

import type { Database } from "bun:sqlite"
import { z } from "zod"

import { DocumentVersionIdSchema, JobPostVersionIdSchema } from "../db/ids"
import { ResearchSourceIdSchema } from "../db/research-conversation-types"

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const DisclosureInputRefSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("document_version"), documentVersionId: DocumentVersionIdSchema })
    .strict(),
  z
    .object({ kind: z.literal("job_post_version"), jobPostVersionId: JobPostVersionIdSchema })
    .strict(),
  z
    .object({ kind: z.literal("research_source"), researchSourceId: ResearchSourceIdSchema })
    .strict(),
  z.object({ kind: z.literal("artifact_revision"), artifactRevisionId: z.string().uuid() }).strict()
])
export type DisclosureInputRef = z.output<typeof DisclosureInputRefSchema>
export type ResolvedDisclosureInput = {
  readonly ref: DisclosureInputRef
  readonly type: DisclosureInputRef["kind"]
  readonly hash: string
  readonly label: string
  readonly version: number | null
  readonly parentCurrentId: string | null
}

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
    .join(",")}}`
}
const hash = (value: string): string => createHash("sha256").update(value).digest("hex")
const documentRow = z.object({
  id: z.string().uuid(),
  label: z.string(),
  hash: HashSchema,
  version: z.number().int(),
  current: z.string().uuid().nullable(),
  state: z.enum(["active", "archived", "deleted"])
})
const jobRow = z.object({
  id: z.string().uuid(),
  label: z.string(),
  bodyHash: HashSchema.nullable(),
  content: z.string(),
  version: z.number().int(),
  current: z.string().uuid().nullable(),
  state: z.enum(["active", "archived", "deleted"])
})
const researchRow = z.object({
  id: z.string().uuid(),
  label: z.string(),
  hash: HashSchema,
  status: z.enum(["available", "failed", "archived"])
})
const artifactRow = z.object({
  id: z.string().uuid(),
  hash: HashSchema,
  number: z.number().int(),
  seriesId: z.string().uuid(),
  current: z.string().uuid().nullable(),
  status: z.enum(["draft", "archived", "deleted"])
})

export class DisclosureSourceError extends Error {
  override readonly name = "DisclosureSourceError"
  constructor(readonly code: "SOURCE_UNAVAILABLE" | "SOURCE_INVALID") {
    super(code)
  }
}

export class DisclosureSourceResolver {
  constructor(private readonly database: Database) {}

  resolve(input: DisclosureInputRef): ResolvedDisclosureInput {
    switch (input.kind) {
      case "document_version":
        return this.document(input)
      case "job_post_version":
        return this.jobPost(input)
      case "research_source":
        return this.research(input)
      case "artifact_revision":
        return this.artifact(input)
      default:
        return assertNever(input)
    }
  }

  private document(
    input: Extract<DisclosureInputRef, { readonly kind: "document_version" }>
  ): ResolvedDisclosureInput {
    const row = this.database
      .query<unknown, [string]>(
        "SELECT v.id,d.title label,v.blob_hash hash,v.version_number version,d.current_version_id current,d.state FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE v.id=?"
      )
      .get(input.documentVersionId)
    const value = documentRow.nullable().parse(row)
    if (value === null || value.state === "deleted")
      throw new DisclosureSourceError("SOURCE_UNAVAILABLE")
    return {
      ref: input,
      type: input.kind,
      hash: value.hash,
      label: value.label,
      version: value.version,
      parentCurrentId: value.current
    }
  }

  private jobPost(
    input: Extract<DisclosureInputRef, { readonly kind: "job_post_version" }>
  ): ResolvedDisclosureInput {
    const row = this.database
      .query<unknown, [string]>(
        "SELECT v.id,p.title label,v.body_blob_hash bodyHash,v.structured_content content,v.version_number version,p.current_version_id current,p.state FROM job_post_versions v JOIN job_posts p ON p.id=v.job_post_id WHERE v.id=?"
      )
      .get(input.jobPostVersionId)
    const value = jobRow.nullable().parse(row)
    if (value === null || value.state === "deleted")
      throw new DisclosureSourceError("SOURCE_UNAVAILABLE")
    const content = z.record(z.string(), z.json()).parse(JSON.parse(value.content))
    return {
      ref: input,
      type: input.kind,
      hash: value.bodyHash ?? hash(canonical(content)),
      label: value.label,
      version: value.version,
      parentCurrentId: value.current
    }
  }

  private research(
    input: Extract<DisclosureInputRef, { readonly kind: "research_source" }>
  ): ResolvedDisclosureInput {
    const row = this.database
      .query<unknown, [string]>(
        "SELECT id,title label,content_hash hash,status FROM research_sources WHERE id=?"
      )
      .get(input.researchSourceId)
    const value = researchRow.nullable().parse(row)
    if (value === null || value.status !== "available")
      throw new DisclosureSourceError("SOURCE_UNAVAILABLE")
    return {
      ref: input,
      type: input.kind,
      hash: value.hash,
      label: value.label,
      version: null,
      parentCurrentId: null
    }
  }

  private artifact(
    input: Extract<DisclosureInputRef, { readonly kind: "artifact_revision" }>
  ): ResolvedDisclosureInput {
    const row = this.database
      .query<unknown, [string]>(
        "SELECT r.id,r.content_hash hash,r.revision_number number,r.series_id seriesId,(SELECT id FROM draft_artifact_revisions WHERE series_id=r.series_id ORDER BY revision_number DESC LIMIT 1) current,s.status FROM draft_artifact_revisions r JOIN draft_artifact_series s ON s.id=r.series_id WHERE r.id=?"
      )
      .get(input.artifactRevisionId)
    const value = artifactRow.nullable().parse(row)
    if (value === null || value.status === "deleted")
      throw new DisclosureSourceError("SOURCE_UNAVAILABLE")
    return {
      ref: input,
      type: input.kind,
      hash: value.hash,
      label: "Draft artifact",
      version: value.number,
      parentCurrentId: value.current
    }
  }
}

const assertNever = (value: never): never => {
  throw new Error(`Unexpected disclosure source ${JSON.stringify(value)}`)
}
