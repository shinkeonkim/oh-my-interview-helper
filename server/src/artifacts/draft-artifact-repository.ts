import { createHash } from "node:crypto"

import type { Database } from "bun:sqlite"
import { z } from "zod"

const ArtifactKindSchema = z.enum([
  "cover_letter",
  "resume",
  "interview_brief",
  "application_answer"
])
const ArtifactStatusSchema = z.enum(["draft", "archived", "deleted"])
const JsonSchema = z.record(z.string(), z.json())
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const ProviderModeSchema = z.enum(["api", "runner", "test"])
const SeriesCreateSchema = z.object({ id: z.string().uuid(), kind: ArtifactKindSchema }).strict()
const StoredInputCreateSchema = z
  .object({
    kind: z.string().trim().min(1),
    ref: z.json(),
    hash: HashSchema,
    label: z.string(),
    version: z.number().int().nullable(),
    parentCurrentId: z.string().uuid().nullable()
  })
  .strict()
const RevisionCreateSchema = z
  .object({
    id: z.string().uuid(),
    seriesId: z.string().uuid(),
    content: JsonSchema,
    inputs: z.array(StoredInputCreateSchema).min(1),
    providerRunId: z.string().uuid().nullable(),
    disclosureId: z.string().uuid().nullable(),
    providerId: z.string().trim().min(1),
    providerMode: ProviderModeSchema,
    providerModel: z.string().trim().min(1),
    providerCapabilityRevision: HashSchema,
    promptTemplateId: z.string().trim().min(1),
    promptTemplateRevision: z.string().trim().min(1)
  })
  .strict()
const SeriesSchema = SeriesCreateSchema.extend({ status: ArtifactStatusSchema })
const RevisionSchema = RevisionCreateSchema.omit({ inputs: true, content: true }).extend({
  number: z.number().int().positive(),
  contentHash: HashSchema,
  content: JsonSchema,
  createdAt: z.string().datetime()
})
const StoredInputSchema = z.object({
  kind: z.string(),
  ref: z
    .string()
    .transform((value) => JSON.parse(value))
    .pipe(z.json()),
  hash: HashSchema,
  label: z.string(),
  version: z.number().int().nullable(),
  parentCurrentId: z.string().uuid().nullable()
})
export type DraftArtifactSeries = z.output<typeof SeriesSchema>
export type DraftArtifactRevision = z.output<typeof RevisionSchema>
export type DraftArtifactStoredInput = z.output<typeof StoredInputSchema>
export type DraftArtifactStoredProvenance = DraftArtifactRevision & {
  readonly inputs: readonly DraftArtifactStoredInput[]
}

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
    .join(",")}}`
}
const now = (): string => new Date().toISOString()

export class DraftArtifactRepository {
  constructor(private readonly database: Database) {}

  createSeries(input: z.input<typeof SeriesCreateSchema>): DraftArtifactSeries {
    const value = SeriesCreateSchema.parse(input)
    this.database.run(
      "INSERT INTO draft_artifact_series (id,kind,status,created_at) VALUES (?,?,?,?)",
      [value.id, value.kind, "draft", now()]
    )
    return { ...value, status: "draft" }
  }
  createRevision(input: z.input<typeof RevisionCreateSchema>): DraftArtifactRevision {
    const value = RevisionCreateSchema.parse(input)
    return this.database
      .transaction(() => {
        const series = this.getSeries(value.seriesId)
        if (series === null || series.status !== "draft")
          throw new DraftArtifactError("ARTIFACT_SERIES_UNAVAILABLE")
        const number =
          this.database
            .query<{ readonly number: number }, [string]>(
              "SELECT COALESCE(MAX(revision_number),0)+1 number FROM draft_artifact_revisions WHERE series_id=?"
            )
            .get(value.seriesId)?.number ?? 1
        const createdAt = now()
        const contentHash = createHash("sha256").update(canonical(value.content)).digest("hex")
        const contentJson = JSON.stringify(value.content)
        this.database.run(
          "INSERT INTO draft_artifact_content_hashes (content_hash,content_json) VALUES (?,?) ON CONFLICT(content_hash) DO NOTHING",
          [contentHash, contentJson]
        )
        this.database.run(
          "INSERT INTO draft_artifact_revisions (id,series_id,revision_number,provider_run_id,disclosure_id,provider_id,provider_mode,provider_model,provider_capability_revision,prompt_template_id,prompt_template_revision,content_hash,content_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [
            value.id,
            value.seriesId,
            number,
            value.providerRunId,
            value.disclosureId,
            value.providerId,
            value.providerMode,
            value.providerModel,
            value.providerCapabilityRevision,
            value.promptTemplateId,
            value.promptTemplateRevision,
            contentHash,
            contentJson,
            createdAt
          ]
        )
        for (const input of value.inputs) {
          this.database.run(
            "INSERT INTO draft_artifact_inputs (revision_id,input_kind,input_ref_json,source_hash,source_label,source_version,parent_current_id) VALUES (?,?,?,?,?,?,?)",
            [
              value.id,
              input.kind,
              JSON.stringify(input.ref),
              input.hash,
              input.label,
              input.version,
              input.parentCurrentId
            ]
          )
        }
        return RevisionSchema.parse({
          id: value.id,
          seriesId: value.seriesId,
          providerRunId: value.providerRunId,
          disclosureId: value.disclosureId,
          providerId: value.providerId,
          providerMode: value.providerMode,
          providerModel: value.providerModel,
          providerCapabilityRevision: value.providerCapabilityRevision,
          promptTemplateId: value.promptTemplateId,
          promptTemplateRevision: value.promptTemplateRevision,
          number,
          contentHash,
          content: value.content,
          createdAt
        })
      })
      .immediate()
  }
  getSeries(id: string): DraftArtifactSeries | null {
    const row = this.database
      .query<unknown, [string]>("SELECT id,kind,status FROM draft_artifact_series WHERE id=?")
      .get(id)
    return row === null ? null : SeriesSchema.parse(row)
  }
  getRevision(id: string): DraftArtifactRevision | null {
    const row = this.database.query<unknown, [string]>(`${revisionSelect} WHERE id=?`).get(id)
    return row === null ? null : this.revision(row)
  }
  listRevisions(seriesId: string): readonly DraftArtifactRevision[] {
    return this.database
      .query<unknown, [string]>(`${revisionSelect} WHERE series_id=? ORDER BY revision_number`)
      .all(seriesId)
      .map((row) => this.revision(row))
  }
  getStoredProvenance(id: string): DraftArtifactStoredProvenance {
    const revision = this.getRevision(id)
    if (revision === null) throw new DraftArtifactError("ARTIFACT_REVISION_NOT_FOUND")
    const inputs = this.database
      .query<unknown, [string]>(
        "SELECT input_kind kind,input_ref_json ref,source_hash hash,source_label label,source_version version,parent_current_id parentCurrentId FROM draft_artifact_inputs WHERE revision_id=? ORDER BY input_kind,input_ref_json"
      )
      .all(id)
      .map((row) => StoredInputSchema.parse(row))
    return { ...revision, inputs }
  }
  archive(id: string): void {
    this.database.run(
      "UPDATE draft_artifact_series SET status='archived',archived_at=? WHERE id=?",
      [now(), id]
    )
  }
  logicalDelete(id: string): void {
    this.database.run("UPDATE draft_artifact_series SET status='deleted',deleted_at=? WHERE id=?", [
      now(),
      id
    ])
  }
  private revision(row: unknown): DraftArtifactRevision {
    const raw = z.object({ ...RevisionSchema.shape, content: z.string() }).parse(row)
    return RevisionSchema.parse({ ...raw, content: JSON.parse(raw.content) })
  }
}

const revisionSelect =
  "SELECT id,series_id seriesId,revision_number number,provider_run_id providerRunId,disclosure_id disclosureId,provider_id providerId,provider_mode providerMode,provider_model providerModel,provider_capability_revision providerCapabilityRevision,prompt_template_id promptTemplateId,prompt_template_revision promptTemplateRevision,content_hash contentHash,content_json content,created_at createdAt FROM draft_artifact_revisions"

export class DraftArtifactError extends Error {
  override readonly name = "DraftArtifactError"
  constructor(readonly code: "ARTIFACT_SERIES_UNAVAILABLE" | "ARTIFACT_REVISION_NOT_FOUND") {
    super(code)
  }
}
