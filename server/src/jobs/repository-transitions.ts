import type { Database } from "bun:sqlite"

import { appendJobEvent } from "./repository-events"
import { requiredJob, jobColumns, parseJob } from "./repository-store"
import { retryAt } from "./retry-policy"
import { isTerminalJobState, JobTransitionError, type Job } from "./types"

type OwnerInput = { readonly id: string; readonly owner: string; readonly now: string }
type Failure = OwnerInput & { readonly code: string; readonly message: string }

const shouldRetry = (job: Job): boolean =>
  job.retryClass === "local" && job.attemptCount < job.maxAttempts

const cancelled = (database: Database, id: string, now: string): Job => {
  database.run(
    "UPDATE durable_jobs SET state='cancelled',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?",
    [now, id]
  )
  appendJobEvent(database, id, "cancelled", { state: "cancelled" }, now)
  return requiredJob(database, id)
}

const resolveFailure = (
  database: Database,
  job: Job,
  code: string,
  message: string,
  now: string
): Job => {
  if (job.cancellationRequestedAt !== null) return cancelled(database, job.id, now)
  if (shouldRetry(job)) {
    const nextAttemptAt = retryAt(now, job.attemptCount)
    database.run(
      "UPDATE durable_jobs SET state='queued',lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=?,last_error_code=?,last_error_message=?,updated_at=? WHERE id=?",
      [nextAttemptAt, code, message, now, job.id]
    )
    appendJobEvent(database, job.id, "retry_scheduled", { retryAt: nextAttemptAt }, now)
    return requiredJob(database, job.id)
  }
  database.run(
    "UPDATE durable_jobs SET state='failed',lease_owner=NULL,lease_expires_at=NULL,error_code=?,error_message=?,last_error_code=?,last_error_message=?,updated_at=? WHERE id=?",
    [code, message, code, message, now, job.id]
  )
  appendJobEvent(database, job.id, "failed", { state: "failed", code }, now)
  return requiredJob(database, job.id)
}

export const startJob = (database: Database, input: OwnerInput): Job => {
  const changed = database.run(
    "UPDATE durable_jobs SET state='running',updated_at=? WHERE id=? AND state='leased' AND lease_owner=? AND lease_expires_at>?",
    [input.now, input.id, input.owner, input.now]
  ).changes
  if (changed !== 1) throw new JobTransitionError("JOB_TRANSITION_INVALID")
  appendJobEvent(database, input.id, "running", { state: "running" }, input.now)
  return requiredJob(database, input.id)
}

export const heartbeatJob = (
  database: Database,
  input: OwnerInput & { readonly leaseMilliseconds: number }
): Job => {
  const expiresAt = new Date(new Date(input.now).getTime() + input.leaseMilliseconds).toISOString()
  const changed = database.run(
    "UPDATE durable_jobs SET lease_expires_at=?,updated_at=? WHERE id=? AND lease_owner=? AND state IN ('leased','running') AND lease_expires_at>?",
    [expiresAt, input.now, input.id, input.owner, input.now]
  ).changes
  if (changed !== 1) throw new JobTransitionError("JOB_TRANSITION_INVALID")
  return requiredJob(database, input.id)
}

export const succeedJob = (database: Database, input: OwnerInput): Job => {
  const current = requiredJob(database, input.id)
  if (
    current.state !== "running" ||
    current.leaseOwner !== input.owner ||
    current.leaseExpiresAt === null ||
    current.leaseExpiresAt <= input.now
  )
    throw new JobTransitionError("JOB_TRANSITION_INVALID")
  if (current.cancellationRequestedAt !== null) return cancelled(database, input.id, input.now)
  database.run(
    "UPDATE durable_jobs SET state='succeeded',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?",
    [input.now, input.id]
  )
  appendJobEvent(database, input.id, "succeeded", { state: "succeeded" }, input.now)
  return requiredJob(database, input.id)
}

export const failJob = (database: Database, input: Failure): Job => {
  const current = requiredJob(database, input.id)
  if (
    current.state !== "running" ||
    current.leaseOwner !== input.owner ||
    current.leaseExpiresAt === null ||
    current.leaseExpiresAt <= input.now
  )
    throw new JobTransitionError("JOB_TRANSITION_INVALID")
  return resolveFailure(database, current, input.code, input.message, input.now)
}

export const cancelJob = (
  database: Database,
  input: { readonly id: string; readonly now: string }
): Job => {
  const current = requiredJob(database, input.id)
  if (isTerminalJobState(current.state) || current.cancellationRequestedAt !== null) return current
  if (current.state === "running") {
    database.run("UPDATE durable_jobs SET cancellation_requested_at=?,updated_at=? WHERE id=?", [
      input.now,
      input.now,
      input.id
    ])
    appendJobEvent(database, input.id, "cancellation_requested", { state: "running" }, input.now)
    return requiredJob(database, input.id)
  }
  return cancelled(database, input.id, input.now)
}

export const finishCancellation = (database: Database, input: OwnerInput): Job => {
  const current = requiredJob(database, input.id)
  if (current.state !== "running" || current.leaseOwner !== input.owner)
    throw new JobTransitionError("JOB_TRANSITION_INVALID")
  return cancelled(database, input.id, input.now)
}

export const interruptJob = (database: Database, input: OwnerInput): Job => {
  const current = requiredJob(database, input.id)
  if (
    (current.state !== "leased" && current.state !== "running") ||
    current.leaseOwner !== input.owner
  )
    throw new JobTransitionError("JOB_TRANSITION_INVALID")
  return resolveFailure(database, current, "interrupted", "Scheduler stopped", input.now)
}

export const recoverExpiredJobs = (database: Database, now: string): readonly Job[] =>
  database
    .transaction(() => {
      const stale = database
        .query<unknown, [string]>(
          `SELECT ${jobColumns} FROM durable_jobs WHERE state IN ('leased','running') AND lease_expires_at<=?`
        )
        .all(now)
        .map(parseJob)
      for (const job of stale) resolveFailure(database, job, "interrupted", "Lease expired", now)
      return stale.map((job) => requiredJob(database, job.id))
    })
    .immediate()
