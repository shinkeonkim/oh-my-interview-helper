import type { Database } from "bun:sqlite"
import { z } from "zod"
import {
  ResearchAnalysisSchema,
  ResearchRequestSchema,
  type ResearchAnalysis,
  type ResearchRequest
} from "./contracts"

const Id = z.string().uuid()
const Timestamp = z.string().datetime()
const SourceInput = z.object({
  id: Id,
  url: z.string().url(),
  title: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  excerpt: z.string(),
  status: z.enum(["available", "failed"]),
  bodyBlobHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  retrievedAt: Timestamp
})

export class CitedResearchRepository {
  constructor(private readonly database: Database) {}
  save(input: {
    readonly id: string
    readonly request: ResearchRequest
    readonly analysis: ResearchAnalysis
    readonly sources: readonly z.output<typeof SourceInput>[]
    readonly contentBlobHash: string | null
    readonly createdAt: string
  }): void {
    const id = Id.parse(input.id)
    const request = ResearchRequestSchema.parse(input.request)
    const analysis = ResearchAnalysisSchema.parse(input.analysis)
    const sources = z.array(SourceInput).parse(input.sources)
    const sourceIds = new Set(
      sources.filter((source) => source.status === "available").map((source) => source.id)
    )
    for (const claim of analysis.claims) {
      if (claim.classification === "fact" && claim.sourceIds.length === 0)
        throw new ResearchIntegrityError("fact_uncited")
      if (claim.sourceIds.some((sourceId) => !sourceIds.has(sourceId)))
        throw new ResearchIntegrityError("source_missing")
    }
    for (const candidate of analysis.identity.candidates)
      if (candidate.sourceIds.some((sourceId) => !sourceIds.has(sourceId)))
        throw new ResearchIntegrityError("source_missing")
    this.database
      .transaction(() => {
        this.database.run(
          "INSERT INTO research_records (id,job_post_id,kind,status,content_blob_hash,created_at,subject_type,subject_name,parent_record_id,identity_status,identity_candidates_json,analysis_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          [
            id,
            request.jobPostId,
            request.subjectType,
            "active",
            input.contentBlobHash,
            Timestamp.parse(input.createdAt),
            request.subjectType,
            request.subjectName,
            request.parentRecordId,
            analysis.identity.status,
            JSON.stringify(analysis.identity.candidates),
            JSON.stringify({
              summary: analysis.summary,
              fitAssessment: analysis.fitAssessment,
              organization: request.organization,
              roleHint: request.roleHint
            })
          ]
        )
        for (const source of sources)
          this.database.run(
            "INSERT INTO research_sources (id,research_record_id,canonical_url,title,content_hash,excerpt,status,body_blob_hash,retrieved_at) VALUES (?,?,?,?,?,?,?,?,?)",
            [
              source.id,
              id,
              source.url,
              source.title,
              source.contentHash,
              source.excerpt,
              source.status,
              source.bodyBlobHash,
              source.retrievedAt
            ]
          )
        for (const claim of analysis.claims)
          this.database.run(
            "INSERT INTO research_claims (id,research_record_id,statement,classification,source_ids_json,confidence,created_at) VALUES (?,?,?,?,?,?,?)",
            [
              crypto.randomUUID(),
              id,
              claim.statement,
              claim.classification,
              JSON.stringify(claim.sourceIds),
              claim.confidence,
              input.createdAt
            ]
          )
      })
      .immediate()
  }
  list(jobPostId: string | null) {
    return this.database
      .query<unknown, [string | null]>(
        "SELECT id,job_post_id jobPostId,subject_type subjectType,subject_name subjectName,parent_record_id parentRecordId,identity_status identityStatus,identity_candidates_json identityCandidates,analysis_json analysis,created_at createdAt FROM research_records WHERE job_post_id IS ? ORDER BY created_at DESC,id DESC"
      )
      .all(jobPostId)
      .map(mapRecord)
  }
  get(id: string) {
    const row = this.database
      .query<unknown, [string]>(
        "SELECT id,job_post_id jobPostId,subject_type subjectType,subject_name subjectName,parent_record_id parentRecordId,identity_status identityStatus,identity_candidates_json identityCandidates,analysis_json analysis,created_at createdAt FROM research_records WHERE id=?"
      )
      .get(Id.parse(id))
    if (row === null) return null
    const record = mapRecord(row)
    const sources = this.database
      .query<unknown, [string]>(
        "SELECT id,canonical_url url,title,content_hash contentHash,excerpt,status,retrieved_at retrievedAt FROM research_sources WHERE research_record_id=? ORDER BY retrieved_at,id"
      )
      .all(id)
      .map(mapSource)
    const claims = this.database
      .query<unknown, [string]>(
        "SELECT id,statement,classification,source_ids_json sourceIds,confidence,created_at createdAt FROM research_claims WHERE research_record_id=? ORDER BY created_at,id"
      )
      .all(id)
      .map(mapClaim)
    return { ...record, sources, claims }
  }
}
const mapRecord = (row: unknown) =>
  z
    .object({
      id: Id,
      jobPostId: Id.nullable(),
      subjectType: z.string(),
      subjectName: z.string(),
      parentRecordId: Id.nullable(),
      identityStatus: z.string(),
      identityCandidates: z.string().transform((v) => JSON.parse(v)),
      analysis: z.string().transform((v) => JSON.parse(v)),
      createdAt: Timestamp
    })
    .parse(row)
const mapSource = (row: unknown) =>
  z
    .object({
      id: Id,
      url: z.string().url(),
      title: z.string(),
      contentHash: z.string(),
      excerpt: z.string(),
      status: z.string(),
      retrievedAt: Timestamp
    })
    .parse(row)
const mapClaim = (row: unknown) =>
  z
    .object({
      id: Id,
      statement: z.string(),
      classification: z.string(),
      sourceIds: z.string().transform((v) => JSON.parse(v)),
      confidence: z.string(),
      createdAt: Timestamp
    })
    .parse(row)
export class ResearchIntegrityError extends Error {
  override readonly name = "ResearchIntegrityError"
  constructor(readonly code: "fact_uncited" | "source_missing") {
    super(`RESEARCH_${code.toUpperCase()}`)
  }
}
