import type { Database } from "bun:sqlite"

import { JobSchema, JobTransitionError, type Job } from "./types"

export const jobColumns =
  "id,kind,state,idempotency_key idempotencyKey,payload_json payload,retry_class retryClass,execution_target executionTarget,attempt_count attemptCount,max_attempts maxAttempts,next_attempt_at nextAttemptAt,cancellation_requested_at cancellationRequestedAt,lease_owner leaseOwner,lease_expires_at leaseExpiresAt,error_code errorCode,error_message errorMessage,last_error_code lastErrorCode,last_error_message lastErrorMessage,created_at createdAt,updated_at updatedAt"

export const parseJob = (row: unknown): Job => JobSchema.parse(row)

export const readJob = (database: Database, id: string): Job | null => {
  const row = database
    .query<unknown, [string]>(`SELECT ${jobColumns} FROM durable_jobs WHERE id=?`)
    .get(id)
  return row === null ? null : parseJob(row)
}

export const requiredJob = (database: Database, id: string): Job => {
  const job = readJob(database, id)
  if (job === null) throw new JobTransitionError("JOB_NOT_FOUND")
  return job
}
