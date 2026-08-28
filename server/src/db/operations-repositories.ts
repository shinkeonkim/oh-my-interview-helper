import type { Database } from "bun:sqlite"
import { z } from "zod"

import { JobsRepository } from "../jobs/repository"
import { nextJobEventSequence } from "../jobs/repository-events"
import { DurableJobIdSchema, type DurableJobId } from "./ids"
import {
  DurableJobCreateSchema,
  DurableJobEventCreateSchema,
  DurableJobEventRowSchema,
  OutboundDisclosureCreateSchema,
  OutboundDisclosureRowSchema,
  ProviderSettingsRowSchema,
  ProviderSettingsUpsertSchema,
  RunnerRegistrationRowSchema,
  RunnerRegistrationUpsertSchema,
  type DurableJob,
  type DurableJobEvent,
  type DurableJobIdempotencyKey,
  type OutboundDisclosure,
  type OutboundDisclosureId,
  type ProviderKind,
  type ProviderSettings,
  type RunnerName,
  type RunnerRegistration
} from "./operations-repository-schemas"

export {
  DurableJobCreateSchema,
  DurableJobEventCreateSchema,
  DurableJobIdempotencyKeySchema,
  OutboundDisclosureCreateSchema,
  OutboundDisclosureIdSchema,
  ProviderKindSchema,
  ProviderSettingsUpsertSchema,
  RunnerNameSchema,
  RunnerRegistrationUpsertSchema
} from "./operations-repository-schemas"
export type {
  DurableJob,
  DurableJobEvent,
  DurableJobIdempotencyKey,
  OutboundDisclosure,
  OutboundDisclosureId,
  ProviderKind,
  ProviderSettings,
  RunnerName,
  RunnerRegistration
} from "./operations-repository-schemas"

const now = (): string => new Date().toISOString()

export class OperationsRepositories {
  private readonly jobs: JobsRepository

  constructor(readonly database: Database) {
    this.jobs = new JobsRepository(database)
  }
  parseJobId(input: z.input<typeof DurableJobIdSchema>): DurableJobId {
    return DurableJobIdSchema.parse(input)
  }
  createJob(input: z.input<typeof DurableJobCreateSchema>): DurableJob {
    const value = DurableJobCreateSchema.parse(input)
    return this.jobs.enqueue({
      id: value.id,
      kind: value.kind,
      input: value.payload,
      idempotencyKey: value.idempotencyKey,
      retryClass: value.retryClass,
      executionTarget: value.executionTarget,
      maxAttempts: value.maxAttempts,
      now: now()
    }).job
  }
  getJob(id: DurableJobId): DurableJob | null {
    return this.jobs.get({ id })
  }
  getJobByIdempotencyKey(idempotencyKey: DurableJobIdempotencyKey): DurableJob | null {
    return this.jobs.list().find((job) => job.idempotencyKey === idempotencyKey) ?? null
  }
  listJobs(): readonly DurableJob[] {
    return this.jobs.list()
  }
  appendJobEvent(input: z.input<typeof DurableJobEventCreateSchema>): DurableJobEvent {
    const value = DurableJobEventCreateSchema.parse(input)
    const createdAt = now()
    return this.database
      .transaction(() => {
        const sequence = nextJobEventSequence(this.database, value.jobId)
        this.database.run(
          "INSERT INTO durable_job_events (id,job_id,sequence,event_kind,payload_json,created_at) VALUES (?,?,?,?,?,?)",
          [value.id, value.jobId, sequence, value.kind, JSON.stringify(value.payload), createdAt]
        )
        return { ...value, sequence, createdAt }
      })
      .immediate()
  }
  listJobEvents(jobId: DurableJobId): readonly DurableJobEvent[] {
    return this.list(
      "SELECT id,job_id jobId,sequence,event_kind kind,payload_json payload,created_at createdAt FROM durable_job_events WHERE job_id=? ORDER BY sequence",
      DurableJobEventRowSchema,
      jobId
    )
  }
  upsertProviderSettings(input: z.input<typeof ProviderSettingsUpsertSchema>): ProviderSettings {
    const value = ProviderSettingsUpsertSchema.parse(input)
    this.database.run(
      "INSERT INTO provider_settings (provider_kind,selected_model,enabled,capability_json,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(provider_kind) DO UPDATE SET selected_model=excluded.selected_model,enabled=excluded.enabled,capability_json=excluded.capability_json,updated_at=excluded.updated_at",
      [
        value.providerKind,
        value.selectedModel,
        Number(value.enabled),
        JSON.stringify(value.capabilities),
        value.updatedAt
      ]
    )
    return value
  }
  getProviderSettings(providerKind: ProviderKind): ProviderSettings | null {
    return this.getOne(
      "SELECT provider_kind providerKind,selected_model selectedModel,enabled,capability_json capabilities,updated_at updatedAt FROM provider_settings WHERE provider_kind=?",
      providerKind,
      ProviderSettingsRowSchema
    )
  }
  listProviderSettings(): readonly ProviderSettings[] {
    return this.list(
      "SELECT provider_kind providerKind,selected_model selectedModel,enabled,capability_json capabilities,updated_at updatedAt FROM provider_settings ORDER BY provider_kind",
      ProviderSettingsRowSchema
    )
  }
  recordDisclosure(input: z.input<typeof OutboundDisclosureCreateSchema>): OutboundDisclosure {
    const value = OutboundDisclosureCreateSchema.parse(input)
    this.database.run(
      "INSERT INTO outbound_disclosures (id,request_hash,provider_kind,destination,action,action_at,selected_input_hashes) VALUES (?,?,?,?,?,?,?)",
      [
        value.id,
        value.requestHash,
        value.providerKind,
        value.destination,
        value.action,
        value.actionAt,
        JSON.stringify(value.selectedInputHashes)
      ]
    )
    return value
  }
  getDisclosure(id: OutboundDisclosureId): OutboundDisclosure | null {
    return this.getOne(
      "SELECT id,request_hash requestHash,provider_kind providerKind,destination,action,action_at actionAt,selected_input_hashes selectedInputHashes FROM outbound_disclosures WHERE id=?",
      id,
      OutboundDisclosureRowSchema
    )
  }
  listDisclosures(): readonly OutboundDisclosure[] {
    return this.list(
      "SELECT id,request_hash requestHash,provider_kind providerKind,destination,action,action_at actionAt,selected_input_hashes selectedInputHashes FROM outbound_disclosures ORDER BY action_at,id",
      OutboundDisclosureRowSchema
    )
  }
  upsertRunnerRegistration(
    input: z.input<typeof RunnerRegistrationUpsertSchema>
  ): RunnerRegistration {
    const value = RunnerRegistrationUpsertSchema.parse(input)
    const existing = this.database
      .query<{ readonly status: "active" | "revoked" }, [RunnerName]>(
        "SELECT status FROM runner_registrations WHERE runner_name=?"
      )
      .get(value.runnerName)
    if (existing?.status === "revoked") throw new RunnerRegistrationRevokedError(value.runnerName)
    const row = this.database
      .query<unknown, [string, string, string, string, string, string, string, string | null]>(
        "INSERT INTO runner_registrations (id,runner_name,token_hash,capability_json,status,registered_at,last_seen_at,revoked_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(runner_name) DO UPDATE SET token_hash=excluded.token_hash,capability_json=excluded.capability_json,status=excluded.status,last_seen_at=excluded.last_seen_at,revoked_at=excluded.revoked_at RETURNING id,runner_name runnerName,token_hash tokenHash,capability_json capabilities,status,registered_at registeredAt,last_seen_at lastSeenAt,revoked_at revokedAt"
      )
      .get(
        value.id,
        value.runnerName,
        value.tokenHash,
        JSON.stringify(value.capabilities),
        value.status,
        value.registeredAt,
        value.lastSeenAt,
        value.revokedAt
      )
    return RunnerRegistrationRowSchema.parse(row)
  }
  getRunnerRegistration(runnerName: RunnerName): RunnerRegistration | null {
    return this.getOne(
      "SELECT id,runner_name runnerName,token_hash tokenHash,capability_json capabilities,status,registered_at registeredAt,last_seen_at lastSeenAt,revoked_at revokedAt FROM runner_registrations WHERE runner_name=?",
      runnerName,
      RunnerRegistrationRowSchema
    )
  }
  transaction<T>(action: () => T): T {
    return this.database.transaction(action).immediate()
  }
  private getOne<T>(sql: string, parameter: string, schema: z.ZodType<T>): T | null {
    const row = this.database.query<unknown, [string]>(sql).get(parameter)
    return row === null ? null : this.mapRow(row, schema)
  }
  private list<T>(sql: string, schema: z.ZodType<T>, parameter?: string): readonly T[] {
    const rows =
      parameter === undefined
        ? this.database.query<unknown, []>(sql).all()
        : this.database.query<unknown, [string]>(sql).all(parameter)
    return rows.map((row) => this.mapRow(row, schema))
  }
  private mapRow<T>(row: unknown, schema: z.ZodType<T>): T {
    const parsed = this.parseRow(row)
    return schema.parse(parsed)
  }
  private parseRow(row: unknown): Record<string, unknown> {
    return z.record(z.string(), z.unknown()).parse(row)
  }
}

export class RunnerRegistrationRevokedError extends Error {
  override readonly name = "RunnerRegistrationRevokedError"
  constructor(readonly runnerName: RunnerName) {
    super("RUNNER_REGISTRATION_REVOKED")
  }
}
