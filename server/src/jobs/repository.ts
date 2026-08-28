import type { Database } from "bun:sqlite"
import type { z } from "zod"

import { appendJobEvent, listJobEvents, listJobEventsAfter } from "./repository-events"
import { jobColumns, parseJob, readJob, requiredJob } from "./repository-store"
import {
  cancelJob,
  failJob,
  finishCancellation,
  heartbeatJob,
  interruptJob,
  recoverExpiredJobs,
  startJob,
  succeedJob,
  type JobTerminalAction
} from "./repository-transitions"
import {
  assertSecretFreeJobInput,
  canonicalJson,
  EnqueueJobSchema,
  IdempotencyConflictError,
  JobEventRetentionError,
  JobTransitionError,
  isTerminalJobState,
  type Job,
  type JobEventPayload,
  type JobEventReplay,
  type JobEvent,
  type TerminalJobState
} from "./types"

type JobIdInput = { readonly id: string }
type OwnerInput = JobIdInput & { readonly owner: string; readonly now: string }

export class JobsRepository {
  private readonly eventListeners = new Set<(jobId: string) => void>()

  constructor(private readonly database: Database) {}

  onEventCommitted(listener: (jobId: string) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  enqueue(input: z.input<typeof EnqueueJobSchema>): {
    readonly job: Job
    readonly created: boolean
  } {
    assertSecretFreeJobInput(input.input)
    const value = EnqueueJobSchema.parse(input)
    const payload = canonicalJson(value.input)
    const result = this.database
      .transaction(() => {
        const existing = this.byIdempotencyKey(value.idempotencyKey)
        if (existing !== null) {
          if (
            existing.kind !== value.kind ||
            canonicalJson(existing.payload) !== payload ||
            existing.retryClass !== value.retryClass ||
            existing.executionTarget !== value.executionTarget ||
            existing.maxAttempts !== value.maxAttempts
          )
            throw new IdempotencyConflictError()
          return { job: existing, created: false }
        }
        this.database.run(
          "INSERT INTO durable_jobs (id,kind,state,idempotency_key,payload_json,retry_class,execution_target,attempt_count,max_attempts,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          [
            value.id,
            value.kind,
            "queued",
            value.idempotencyKey,
            payload,
            value.retryClass,
            value.executionTarget,
            0,
            value.maxAttempts,
            value.now,
            value.now
          ]
        )
        appendJobEvent(this.database, value.id, "queued", { state: "queued" }, value.now)
        return { job: requiredJob(this.database, value.id), created: true }
      })
      .immediate()
    if (result.created) this.notify(result.job.id)
    return result
  }

  get(input: JobIdInput): Job | null {
    return readJob(this.database, input.id)
  }

  list(): readonly Job[] {
    return this.database
      .query<unknown, []>(`SELECT ${jobColumns} FROM durable_jobs ORDER BY created_at,rowid`)
      .all()
      .map(parseJob)
  }

  claim(input: {
    readonly owner: string
    readonly now: string
    readonly leaseMilliseconds: number
  }): { readonly job: Job } {
    const expiresAt = new Date(
      new Date(input.now).getTime() + input.leaseMilliseconds
    ).toISOString()
    const result = this.database
      .transaction(() => {
        const row = this.database
          .query<{ readonly id: string }, [string]>(
            "SELECT id FROM durable_jobs WHERE state='queued' AND execution_target='app' AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY created_at,rowid LIMIT 1"
          )
          .get(input.now)
        if (row === null) throw new JobTransitionError("JOB_NOT_CLAIMABLE")
        const changed = this.database.run(
          "UPDATE durable_jobs SET state='leased',lease_owner=?,lease_expires_at=?,attempt_count=attempt_count+1,updated_at=? WHERE id=? AND state='queued'",
          [input.owner, expiresAt, input.now, row.id]
        ).changes
        if (changed !== 1) throw new JobTransitionError("JOB_NOT_CLAIMABLE")
        appendJobEvent(
          this.database,
          row.id,
          "leased",
          { state: "leased", leaseExpiresAt: expiresAt },
          input.now
        )
        return { job: requiredJob(this.database, row.id) }
      })
      .immediate()
    this.notify(result.job.id)
    return result
  }

  start(input: OwnerInput): { readonly job: Job } {
    return this.transition(() => startJob(this.database, input))
  }
  heartbeat(input: OwnerInput & { readonly leaseMilliseconds: number }): { readonly job: Job } {
    return this.transition(() => heartbeatJob(this.database, input))
  }
  succeed(input: OwnerInput): { readonly job: Job } {
    return this.transition(() => succeedJob(this.database, input))
  }
  fail(input: OwnerInput & { readonly code: string; readonly message: string }): {
    readonly job: Job
  } {
    return this.transition(() => failJob(this.database, input))
  }
  cancel(input: JobIdInput & { readonly now: string }): { readonly job: Job } {
    return this.transition(() => cancelJob(this.database, input))
  }
  finishCancellation(input: OwnerInput): { readonly job: Job } {
    return this.transition(() => finishCancellation(this.database, input))
  }
  interrupt(input: OwnerInput): { readonly job: Job } {
    return this.transition(() => interruptJob(this.database, input))
  }
  terminal(
    input: OwnerInput & {
      readonly action: JobTerminalAction
      readonly onTerminal: (job: Job, state: TerminalJobState) => void
    }
  ): { readonly job: Job } {
    return this.transition(() => {
      const job = this.applyTerminalAction(input)
      if (isTerminalJobState(job.state)) input.onTerminal(job, job.state)
      return job
    })
  }
  recoverExpired(input: { readonly now: string }): readonly Job[] {
    const jobs = recoverExpiredJobs(this.database, input.now)
    for (const job of jobs) this.notify(job.id)
    return jobs
  }
  events(input: JobIdInput): readonly JobEvent[] {
    return listJobEvents(this.database, input.id)
  }
  eventsAfter(input: JobIdInput & { readonly eventId: string | null }): JobEventReplay {
    return listJobEventsAfter(this.database, input)
  }
  appendProgress(
    input: JobIdInput & { readonly payload: JobEventPayload; readonly now: string }
  ): JobEvent {
    const event = this.database
      .transaction(() => {
        const job = requiredJob(this.database, input.id)
        if (isTerminalJobState(job.state)) throw new JobTransitionError("JOB_TRANSITION_INVALID")
        return appendJobEvent(this.database, input.id, "progress", input.payload, input.now)
      })
      .immediate()
    this.notify(input.id)
    return event
  }
  retainEvents(
    input: JobIdInput & {
      readonly now: string
      readonly progressLimit: number
      readonly progressMaxAgeMilliseconds: number
    }
  ): void {
    if (
      !Number.isInteger(input.progressLimit) ||
      input.progressLimit < 0 ||
      !Number.isInteger(input.progressMaxAgeMilliseconds) ||
      input.progressMaxAgeMilliseconds < 0
    )
      throw new JobEventRetentionError()
    const cutoff = new Date(
      new Date(input.now).getTime() - input.progressMaxAgeMilliseconds
    ).toISOString()
    this.database
      .transaction(() => {
        const prunable = this.database
          .query<{ readonly sequence: number }, [string, string, string, number]>(
            "SELECT sequence FROM durable_job_events WHERE job_id=? AND event_kind='progress' AND (created_at<? OR sequence NOT IN (SELECT sequence FROM durable_job_events WHERE job_id=? AND event_kind='progress' ORDER BY sequence DESC LIMIT ?)) ORDER BY sequence"
          )
          .all(input.id, cutoff, input.id, input.progressLimit)
        const last = prunable.at(-1)
        if (last === undefined) return
        this.database.run(
          "DELETE FROM durable_job_events WHERE job_id=? AND event_kind='progress' AND (created_at<? OR sequence NOT IN (SELECT sequence FROM durable_job_events WHERE job_id=? AND event_kind='progress' ORDER BY sequence DESC LIMIT ?))",
          [input.id, cutoff, input.id, input.progressLimit]
        )
        this.database.run(
          "INSERT INTO durable_job_event_replay_watermarks (job_id,minimum_resume_sequence) VALUES (?,?) ON CONFLICT(job_id) DO UPDATE SET minimum_resume_sequence=MAX(minimum_resume_sequence,excluded.minimum_resume_sequence)",
          [input.id, last.sequence + 1]
        )
      })
      .immediate()
  }

  private byIdempotencyKey(key: string): Job | null {
    const row = this.database
      .query<unknown, [string]>(`SELECT ${jobColumns} FROM durable_jobs WHERE idempotency_key=?`)
      .get(key)
    return row === null ? null : parseJob(row)
  }

  private transition(action: () => Job): { readonly job: Job } {
    const result = this.database.transaction(() => ({ job: action() })).immediate()
    this.notify(result.job.id)
    return result
  }
  private applyTerminalAction(input: OwnerInput & { readonly action: JobTerminalAction }): Job {
    switch (input.action.kind) {
      case "succeed":
        return succeedJob(this.database, input)
      case "fail":
        return failJob(this.database, { ...input, ...input.action })
      case "cancel":
        return finishCancellation(this.database, input)
      case "interrupt":
        return interruptJob(this.database, input)
    }
  }

  private notify(jobId: string): void {
    for (const listener of this.eventListeners) listener(jobId)
  }
}
