import type { Database } from "bun:sqlite"
import { z } from "zod"
import { PublicHttpUrlSchema } from "../security/public-url"

const Id = z.string().uuid()
const Timestamp = z.string().datetime()
const JsonObject = z.record(z.string(), z.json())
export const OutcomeSchema = z.enum(["offered", "rejected", "withdrawn"])

const StageRow = z.object({
  id: Id,
  key: z.string(),
  name: z.string(),
  position: z.number().int().positive(),
  outcome: OutcomeSchema.nullable(),
  system: z.union([z.literal(0), z.literal(1)]).transform(Boolean)
})
const PostRow = z.object({
  id: Id,
  title: z.string(),
  companyName: z.string(),
  teamName: z.string().nullable(),
  canonicalUrl: z.string().nullable(),
  metadata: z
    .string()
    .transform((value) => JSON.parse(value))
    .pipe(JsonObject),
  state: z.enum(["active", "archived", "deleted"]),
  currentVersionId: Id.nullable(),
  versionNumber: z.number().int().positive().nullable(),
  sourceKind: z.enum(["manual", "file", "url"]).nullable(),
  createdAt: Timestamp
})
const VersionRow = z.object({
  id: Id,
  postId: Id,
  versionNumber: z.number().int().positive(),
  sourceKind: z.enum(["manual", "file", "url"]),
  bodyBlobHash: z.string().regex(/^[a-f0-9]{64}$/),
  content: z
    .string()
    .transform((value) => JSON.parse(value))
    .pipe(JsonObject),
  createdAt: Timestamp
})
const ApplicationRow = z.object({
  id: Id,
  jobPostId: Id,
  idempotencyKey: Id,
  status: z.enum(["saved", "applied", "interviewing", "offered", "rejected", "withdrawn"]),
  stageId: Id,
  stageName: z.string(),
  stagePosition: z.number().int().positive(),
  appliedAt: Timestamp.nullable(),
  outcomeAt: Timestamp.nullable(),
  createdAt: Timestamp,
  archivedAt: Timestamp.nullable()
})
const EventRow = z.object({
  id: Id,
  sequence: z.number().int().positive(),
  kind: z.string(),
  payload: z
    .string()
    .transform((value) => JSON.parse(value))
    .pipe(JsonObject),
  createdAt: Timestamp
})
const InterviewRow = z.object({
  id: Id,
  applicationId: Id,
  scheduledAt: Timestamp,
  endedAt: Timestamp.nullable(),
  kind: z.string(),
  location: z.string().nullable(),
  notes: z.string(),
  createdAt: Timestamp
})

export type PipelineStage = z.output<typeof StageRow>
export type JobPosting = z.output<typeof PostRow>
export type JobPostingVersion = z.output<typeof VersionRow>
export type HiringApplication = z.output<typeof ApplicationRow>

export class ApplicationRepository {
  constructor(private readonly database: Database) {}

  stages(): readonly PipelineStage[] {
    return this.database
      .query<unknown, []>(
        "SELECT id,stage_key key,name,position,outcome,is_system system FROM pipeline_stages ORDER BY position"
      )
      .all()
      .map((row) => StageRow.parse(row))
  }
  createStage(input: { id: string; key: string; name: string; createdAt: string }): PipelineStage {
    return this.database
      .transaction(() => {
        const position =
          this.database
            .query<{ value: number }, []>(
              "SELECT COALESCE(MAX(position),0)+1 value FROM pipeline_stages"
            )
            .get()?.value ?? 1
        const id = Id.parse(input.id)
        this.database.run(
          "INSERT INTO pipeline_stages (id,stage_key,name,position,is_system,created_at) VALUES (?,?,?,?,0,?)",
          [
            id,
            z.string().trim().min(1).max(64).parse(input.key),
            z.string().trim().min(1).max(80).parse(input.name),
            position,
            Timestamp.parse(input.createdAt)
          ]
        )
        return StageRow.parse(
          this.database
            .query<unknown, [string]>(
              "SELECT id,stage_key key,name,position,outcome,is_system system FROM pipeline_stages WHERE id=?"
            )
            .get(id)
        )
      })
      .immediate()
  }
  renameStage(id: string, name: string): void {
    if (
      this.database.run("UPDATE pipeline_stages SET name=? WHERE id=?", [
        z.string().trim().min(1).max(80).parse(name),
        Id.parse(id)
      ]).changes !== 1
    )
      throw new ApplicationDomainError("stage_not_found")
  }
  reorderStages(ids: readonly string[]): void {
    const parsed = z.array(Id).min(1).parse(ids)
    const current = this.stages().map((stage) => stage.id)
    if (new Set(parsed).size !== current.length || current.some((id) => !parsed.includes(id)))
      throw new ApplicationDomainError("invalid_stage_order")
    this.database
      .transaction(() => {
        this.database.run("UPDATE pipeline_stages SET position=position+10000")
        parsed.forEach((id, index) =>
          this.database.run("UPDATE pipeline_stages SET position=? WHERE id=?", [index + 1, id])
        )
      })
      .immediate()
  }
  deleteStage(id: string): void {
    const parsed = Id.parse(id)
    this.database
      .transaction(() => {
        const changed = this.database.run(
          "DELETE FROM pipeline_stages WHERE id=? AND is_system=0",
          [parsed]
        ).changes
        if (changed !== 1) throw new ApplicationDomainError("stage_not_deletable")
        const remaining = this.stages()
        this.database.run("UPDATE pipeline_stages SET position=position+10000")
        remaining.forEach((stage, index) =>
          this.database.run("UPDATE pipeline_stages SET position=? WHERE id=?", [
            index + 1,
            stage.id
          ])
        )
      })
      .immediate()
  }

  createPost(input: {
    id: string
    title: string
    companyName: string
    teamName: string | null
    canonicalUrl: string | null
    metadata: Record<string, unknown>
    createdAt: string
  }): void {
    this.database.run(
      "INSERT INTO job_posts (id,title,company_name,team_name,canonical_url,metadata_json,created_at) VALUES (?,?,?,?,?,?,?)",
      [
        Id.parse(input.id),
        z.string().trim().min(1).max(200).parse(input.title),
        z.string().trim().min(1).max(200).parse(input.companyName),
        z.string().trim().min(1).max(200).nullable().parse(input.teamName),
        PublicHttpUrlSchema.nullable().parse(input.canonicalUrl),
        JSON.stringify(JsonObject.parse(input.metadata)),
        Timestamp.parse(input.createdAt)
      ]
    )
  }
  posts(): readonly JobPosting[] {
    return this.database
      .query<unknown, []>(
        `SELECT p.id,p.title,p.company_name companyName,p.team_name teamName,p.canonical_url canonicalUrl,p.metadata_json metadata,p.state,p.current_version_id currentVersionId,v.version_number versionNumber,v.source_kind sourceKind,p.created_at createdAt FROM job_posts p LEFT JOIN job_post_versions v ON v.id=p.current_version_id WHERE p.state!='deleted' ORDER BY p.created_at DESC`
      )
      .all()
      .map((row) => PostRow.parse(row))
  }
  post(id: string): JobPosting | null {
    return this.posts().find((post) => post.id === Id.parse(id)) ?? null
  }
  addPostVersion(input: {
    id: string
    postId: string
    sourceKind: "manual" | "file" | "url"
    bodyBlobHash: string
    content: Record<string, unknown>
    createdAt: string
  }): void {
    const insert = () => {
      const number =
        this.database
          .query<{ value: number }, [string]>(
            "SELECT COALESCE(MAX(version_number),0)+1 value FROM job_post_versions WHERE job_post_id=?"
          )
          .get(Id.parse(input.postId))?.value ?? 1
      this.database.run(
        "INSERT INTO job_post_versions (id,job_post_id,version_number,source_kind,body_blob_hash,structured_content,created_at) VALUES (?,?,?,?,?,?,?)",
        [
          Id.parse(input.id),
          input.postId,
          number,
          input.sourceKind,
          z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .parse(input.bodyBlobHash),
          JSON.stringify(JsonObject.parse(input.content)),
          Timestamp.parse(input.createdAt)
        ]
      )
      if (
        this.database.run(
          "UPDATE job_posts SET current_version_id=? WHERE id=? AND state='active'",
          [input.id, input.postId]
        ).changes !== 1
      )
        throw new ApplicationDomainError("post_unavailable")
    }
    if (this.database.inTransaction) insert()
    else this.database.transaction(insert).immediate()
  }
  versions(postId: string): readonly JobPostingVersion[] {
    return this.database
      .query<unknown, [string]>(
        "SELECT id,job_post_id postId,version_number versionNumber,source_kind sourceKind,body_blob_hash bodyBlobHash,structured_content content,created_at createdAt FROM job_post_versions WHERE job_post_id=? ORDER BY version_number DESC"
      )
      .all(Id.parse(postId))
      .map((row) => VersionRow.parse(row))
  }
  archivePost(id: string, at: string): void {
    if (
      this.database.run(
        "UPDATE job_posts SET state='archived',archived_at=? WHERE id=? AND state='active'",
        [Timestamp.parse(at), Id.parse(id)]
      ).changes !== 1
    )
      throw new ApplicationDomainError("post_unavailable")
  }

  applications(): readonly HiringApplication[] {
    return this.database
      .query<unknown, []>(
        `SELECT a.id,a.job_post_id jobPostId,a.idempotency_key idempotencyKey,a.status,a.current_stage_id stageId,s.name stageName,s.position stagePosition,a.applied_at appliedAt,a.outcome_at outcomeAt,a.created_at createdAt,a.archived_at archivedAt FROM applications a JOIN pipeline_stages s ON s.id=a.current_stage_id ORDER BY a.created_at DESC`
      )
      .all()
      .map((row) => ApplicationRow.parse(row))
  }
  application(id: string): HiringApplication | null {
    return this.applications().find((item) => item.id === Id.parse(id)) ?? null
  }
  applicationByKey(key: string): HiringApplication | null {
    return this.applications().find((item) => item.idempotencyKey === Id.parse(key)) ?? null
  }
  createApplication(input: {
    id: string
    postId: string
    idempotencyKey: string
    createdAt: string
  }): HiringApplication {
    return this.database
      .transaction(() => {
        const existing = this.applicationByKey(input.idempotencyKey)
        if (existing !== null) {
          if (existing.jobPostId !== input.postId)
            throw new ApplicationDomainError("idempotency_conflict")
          return existing
        }
        const saved = this.stages().find((stage) => stage.key === "saved")
        if (saved === undefined || this.post(input.postId)?.state !== "active")
          throw new ApplicationDomainError("post_unavailable")
        const active = this.database
          .query<{ id: string }, [string]>(
            "SELECT id FROM applications WHERE job_post_id=? AND archived_at IS NULL LIMIT 1"
          )
          .get(input.postId)
        if (active !== null) throw new ApplicationDomainError("active_application_exists")
        this.database.run(
          "INSERT INTO applications (id,job_post_id,status,idempotency_key,current_stage_id,created_at) VALUES (?,?,?,?,?,?)",
          [
            Id.parse(input.id),
            input.postId,
            "saved",
            Id.parse(input.idempotencyKey),
            saved.id,
            Timestamp.parse(input.createdAt)
          ]
        )
        this.appendEventUnsafe(input.id, "created", { stageId: saved.id }, input.createdAt)
        return this.requireApplication(input.id)
      })
      .immediate()
  }
  transition(input: { applicationId: string; stageId: string; at: string }): HiringApplication {
    return this.database
      .transaction(() => {
        const application = this.application(Id.parse(input.applicationId))
        const target = this.stages().find((stage) => stage.id === Id.parse(input.stageId))
        if (application === null || target === undefined || application.archivedAt !== null)
          throw new ApplicationDomainError("transition_denied")
        const current = this.stages().find((stage) => stage.id === application.stageId)
        if (current?.outcome !== null || target.id === application.stageId)
          throw new ApplicationDomainError("transition_denied")
        const status =
          target.outcome ??
          (target.key === "saved" || target.key === "applied" || target.key === "interviewing"
            ? target.key
            : "interviewing")
        this.database.run(
          "UPDATE applications SET current_stage_id=?,status=?,applied_at=CASE WHEN ?='applied' AND applied_at IS NULL THEN ? ELSE applied_at END,outcome_at=CASE WHEN ? IS NOT NULL THEN ? ELSE outcome_at END WHERE id=?",
          [target.id, status, target.key, input.at, target.outcome, input.at, application.id]
        )
        this.appendEventUnsafe(
          application.id,
          "stage_changed",
          { fromStageId: application.stageId, toStageId: target.id, outcome: target.outcome },
          input.at
        )
        return this.requireApplication(application.id)
      })
      .immediate()
  }
  addNote(applicationId: string, text: string, at: string): void {
    this.database
      .transaction(() => {
        this.requireActiveApplication(applicationId)
        this.appendEventUnsafe(
          applicationId,
          "note_added",
          { text: z.string().trim().min(1).max(10_000).parse(text) },
          at
        )
      })
      .immediate()
  }
  scheduleInterview(input: {
    id: string
    applicationId: string
    scheduledAt: string
    endedAt: string | null
    kind: string
    location: string | null
    notes: string
    createdAt: string
  }): void {
    this.database
      .transaction(() => {
        this.requireActiveApplication(input.applicationId)
        this.database.run(
          "INSERT INTO application_interviews (id,application_id,scheduled_at,ended_at,interview_kind,location,notes,created_at) VALUES (?,?,?,?,?,?,?,?)",
          [
            Id.parse(input.id),
            input.applicationId,
            Timestamp.parse(input.scheduledAt),
            Timestamp.nullable().parse(input.endedAt),
            z.string().trim().min(1).max(80).parse(input.kind),
            z.string().trim().max(500).nullable().parse(input.location),
            z.string().max(10_000).parse(input.notes),
            Timestamp.parse(input.createdAt)
          ]
        )
        this.appendEventUnsafe(
          input.applicationId,
          "interview_scheduled",
          { interviewId: input.id, scheduledAt: input.scheduledAt, kind: input.kind },
          input.createdAt
        )
      })
      .immediate()
  }
  interviews(applicationId: string) {
    this.requireApplication(applicationId)
    return this.database
      .query<unknown, [string]>(
        "SELECT id,application_id applicationId,scheduled_at scheduledAt,ended_at endedAt,interview_kind kind,location,notes,created_at createdAt FROM application_interviews WHERE application_id=? ORDER BY scheduled_at,id"
      )
      .all(applicationId)
      .map((row) => InterviewRow.parse(row))
  }
  events(applicationId: string) {
    this.requireApplication(applicationId)
    return this.database
      .query<unknown, [string]>(
        "SELECT id,sequence,event_kind kind,payload,created_at createdAt FROM application_events WHERE application_id=? ORDER BY sequence"
      )
      .all(applicationId)
      .map((row) => EventRow.parse(row))
  }
  archiveApplication(id: string, at: string): void {
    if (
      this.database.run(
        "UPDATE applications SET archived_at=? WHERE id=? AND archived_at IS NULL",
        [Timestamp.parse(at), Id.parse(id)]
      ).changes !== 1
    )
      throw new ApplicationDomainError("application_unavailable")
  }
  private requireApplication(id: string) {
    const application = this.application(id)
    if (application === null) throw new ApplicationDomainError("application_unavailable")
    return application
  }
  private requireActiveApplication(id: string) {
    const application = this.requireApplication(id)
    if (application.archivedAt !== null) throw new ApplicationDomainError("application_unavailable")
    return application
  }
  private appendEventUnsafe(
    applicationId: string,
    kind: string,
    payload: Record<string, unknown>,
    at: string
  ): void {
    const sequence =
      this.database
        .query<{ value: number }, [string]>(
          "SELECT COALESCE(MAX(sequence),0)+1 value FROM application_events WHERE application_id=?"
        )
        .get(applicationId)?.value ?? 1
    this.database.run(
      "INSERT INTO application_events (id,application_id,sequence,event_kind,payload,created_at) VALUES (?,?,?,?,?,?)",
      [
        crypto.randomUUID(),
        applicationId,
        sequence,
        kind,
        JSON.stringify(JsonObject.parse(payload)),
        Timestamp.parse(at)
      ]
    )
  }
}

export class ApplicationDomainError extends Error {
  override readonly name = "ApplicationDomainError"
  constructor(
    readonly code:
      | "application_unavailable"
      | "active_application_exists"
      | "idempotency_conflict"
      | "invalid_stage_order"
      | "post_unavailable"
      | "stage_not_deletable"
      | "stage_not_found"
      | "transition_denied"
  ) {
    super(`APPLICATION_${code.toUpperCase()}`)
  }
}
