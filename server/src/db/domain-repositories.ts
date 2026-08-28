import type { Database } from "bun:sqlite"
import { z } from "zod"

import {
  ApplicationEventIdSchema,
  ApplicationIdSchema,
  ApplicationIdempotencyKeySchema,
  JobPostIdSchema,
  JobPostVersionIdSchema,
  type ApplicationId,
  type JobPostId
} from "./ids"

export const JobPostCreateSchema = z.object({
  id: JobPostIdSchema,
  title: z.string().trim().min(1),
  companyName: z.string().trim().min(1)
})
export type JobPost = z.output<typeof JobPostCreateSchema>
const JsonObjectSchema = z.record(z.string(), z.json())
const StoredJsonObjectSchema = z
  .string()
  .transform((value, context) => {
    try {
      return JSON.parse(value)
    } catch {
      context.addIssue({ code: "custom", message: "Invalid JSON object" })
      return z.NEVER
    }
  })
  .pipe(JsonObjectSchema)
export const JobPostVersionCreateSchema = z.object({
  id: JobPostVersionIdSchema,
  jobPostId: JobPostIdSchema,
  sourceKind: z.enum(["manual", "file", "url"]),
  content: JsonObjectSchema
})
export type JobPostVersion = z.output<typeof JobPostVersionCreateSchema>
export const ApplicationCreateSchema = z.object({
  id: ApplicationIdSchema,
  jobPostId: JobPostIdSchema,
  idempotencyKey: ApplicationIdempotencyKeySchema,
  status: z
    .enum(["saved", "applied", "interviewing", "offered", "rejected", "withdrawn"])
    .default("saved")
})
export type Application = z.output<typeof ApplicationCreateSchema>
export const ApplicationEventCreateSchema = z.object({
  id: ApplicationEventIdSchema,
  applicationId: ApplicationIdSchema,
  kind: z.string().min(1),
  payload: JsonObjectSchema
})
export type ApplicationEvent = z.output<typeof ApplicationEventCreateSchema>
const now = (): string => new Date().toISOString()

export class DomainRepository {
  constructor(private readonly database: Database) {}
  createJobPost(input: z.input<typeof JobPostCreateSchema>): JobPost {
    const value = JobPostCreateSchema.parse(input)
    this.database.run("INSERT INTO job_posts (id,title,company_name,created_at) VALUES (?,?,?,?)", [
      value.id,
      value.title,
      value.companyName,
      now()
    ])
    return value
  }
  getJobPost(id: JobPostId): JobPost | null {
    const row = this.database
      .query<unknown, [string]>(
        "SELECT id,title,company_name companyName FROM job_posts WHERE id=?"
      )
      .get(id)
    return row === null ? null : JobPostCreateSchema.parse(row)
  }
  listJobPosts(): readonly JobPost[] {
    return this.database
      .query<unknown, []>(
        "SELECT id,title,company_name companyName FROM job_posts ORDER BY created_at DESC"
      )
      .all()
      .map((row) => JobPostCreateSchema.parse(row))
  }
  addJobPostVersion(input: z.input<typeof JobPostVersionCreateSchema>): JobPostVersion {
    const value = JobPostVersionCreateSchema.parse(input)
    this.database
      .transaction(() => {
        const version =
          this.database
            .query<{ number: number }, [string]>(
              "SELECT COALESCE(MAX(version_number),0)+1 number FROM job_post_versions WHERE job_post_id=?"
            )
            .get(value.jobPostId)?.number ?? 1
        this.database.run(
          "INSERT INTO job_post_versions (id,job_post_id,version_number,source_kind,structured_content,created_at) VALUES (?,?,?,?,?,?)",
          [
            value.id,
            value.jobPostId,
            version,
            value.sourceKind,
            JSON.stringify(value.content),
            now()
          ]
        )
        this.database.run("UPDATE job_posts SET current_version_id=? WHERE id=?", [
          value.id,
          value.jobPostId
        ])
      })
      .immediate()
    return value
  }
  listJobPostVersions(jobPostId: JobPostId): readonly JobPostVersion[] {
    return this.database
      .query<unknown, [string]>(
        "SELECT id,job_post_id jobPostId,source_kind sourceKind,structured_content content FROM job_post_versions WHERE job_post_id=? ORDER BY version_number"
      )
      .all(jobPostId)
      .map((row) => {
        const parsed = z
          .object({
            id: z.string(),
            jobPostId: z.string(),
            sourceKind: z.string(),
            content: z.string()
          })
          .parse(row)
        return JobPostVersionCreateSchema.parse({
          ...parsed,
          content: StoredJsonObjectSchema.parse(parsed.content)
        })
      })
  }
  createApplication(input: z.input<typeof ApplicationCreateSchema>): Application {
    const value = ApplicationCreateSchema.parse(input)
    this.database.run(
      "INSERT INTO applications (id,job_post_id,status,idempotency_key,created_at) VALUES (?,?,?,?,?)",
      [value.id, value.jobPostId, value.status, value.idempotencyKey, now()]
    )
    return value
  }
  getApplication(id: ApplicationId): Application | null {
    const row = this.database
      .query<unknown, [string]>(
        "SELECT id,job_post_id jobPostId,idempotency_key idempotencyKey,status FROM applications WHERE id=?"
      )
      .get(id)
    return row === null ? null : ApplicationCreateSchema.parse(row)
  }
  listApplications(): readonly Application[] {
    return this.database
      .query<unknown, []>(
        "SELECT id,job_post_id jobPostId,idempotency_key idempotencyKey,status FROM applications ORDER BY created_at DESC"
      )
      .all()
      .map((row) => ApplicationCreateSchema.parse(row))
  }
  appendApplicationEvent(input: z.input<typeof ApplicationEventCreateSchema>): ApplicationEvent {
    const value = ApplicationEventCreateSchema.parse(input)
    this.database
      .transaction(() => {
        const sequence =
          this.database
            .query<{ sequence: number }, [string]>(
              "SELECT COALESCE(MAX(sequence),0)+1 sequence FROM application_events WHERE application_id=?"
            )
            .get(value.applicationId)?.sequence ?? 1
        this.database.run(
          "INSERT INTO application_events (id,application_id,sequence,event_kind,payload,created_at) VALUES (?,?,?,?,?,?)",
          [
            value.id,
            value.applicationId,
            sequence,
            value.kind,
            JSON.stringify(value.payload),
            now()
          ]
        )
      })
      .immediate()
    return value
  }
  listApplicationEvents(applicationId: ApplicationId): readonly ApplicationEvent[] {
    return this.database
      .query<unknown, [string]>(
        "SELECT id,application_id applicationId,event_kind kind,payload FROM application_events WHERE application_id=? ORDER BY sequence"
      )
      .all(applicationId)
      .map((row) => {
        const parsed = z
          .object({
            id: z.string(),
            applicationId: z.string(),
            kind: z.string(),
            payload: z.string()
          })
          .parse(row)
        return ApplicationEventCreateSchema.parse({
          ...parsed,
          payload: StoredJsonObjectSchema.parse(parsed.payload)
        })
      })
  }
}
