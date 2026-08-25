import type { Database } from "bun:sqlite"

import {
  canonicalJson,
  JobEventSchema,
  JobTransitionError,
  type JobEvent,
  type JobEventPayload,
  type JobEventReplay
} from "./types"

const parseEvent = (row: unknown): JobEvent => JobEventSchema.parse(row)

export const appendJobEvent = (
  database: Database,
  jobId: string,
  kind: string,
  payload: JobEventPayload,
  createdAt: string
): JobEvent => {
  const sequence = nextJobEventSequence(database, jobId)
  const id = crypto.randomUUID()
  database.run(
    "INSERT INTO durable_job_events (id,job_id,sequence,event_kind,payload_json,created_at) VALUES (?,?,?,?,?,?)",
    [id, jobId, sequence, kind, canonicalJson(payload), createdAt]
  )
  return JobEventSchema.parse({
    id,
    jobId,
    sequence,
    kind,
    payload: canonicalJson(payload),
    createdAt
  })
}

export const nextJobEventSequence = (database: Database, jobId: string): number => {
  database.run(
    "INSERT OR IGNORE INTO durable_job_event_cursors (job_id,next_sequence) VALUES (?,1)",
    [jobId]
  )
  const cursor = database
    .query<{ readonly sequence: number }, [string]>(
      "SELECT next_sequence sequence FROM durable_job_event_cursors WHERE job_id=?"
    )
    .get(jobId)
  if (cursor === null) throw new JobTransitionError("JOB_NOT_FOUND")
  database.run(
    "UPDATE durable_job_event_cursors SET next_sequence=next_sequence+1 WHERE job_id=?",
    [jobId]
  )
  return cursor.sequence
}

export const listJobEvents = (database: Database, jobId: string): readonly JobEvent[] =>
  database
    .query<unknown, [string]>(
      "SELECT id,job_id jobId,sequence,event_kind kind,payload_json payload,created_at createdAt FROM durable_job_events WHERE job_id=? ORDER BY sequence"
    )
    .all(jobId)
    .map(parseEvent)

export const listJobEventsAfter = (
  database: Database,
  input: { readonly id: string; readonly eventId: string | null }
): JobEventReplay => {
  if (input.eventId === null) return { kind: "events", events: listJobEvents(database, input.id) }
  const event = database
    .query<{ readonly jobId: string; readonly sequence: number }, [string]>(
      "SELECT job_id jobId,sequence FROM durable_job_events WHERE id=?"
    )
    .get(input.eventId)
  if (event === null || event.jobId !== input.id) return { kind: "reset", code: "EVENT_REPLAY_GAP" }
  const watermark = database
    .query<{ readonly minimumResumeSequence: number }, [string]>(
      "SELECT minimum_resume_sequence minimumResumeSequence FROM durable_job_event_replay_watermarks WHERE job_id=?"
    )
    .get(input.id)
  if (watermark !== null && event.sequence < watermark.minimumResumeSequence)
    return { kind: "reset", code: "EVENT_REPLAY_GAP" }
  const events = database
    .query<unknown, [string, number]>(
      "SELECT id,job_id jobId,sequence,event_kind kind,payload_json payload,created_at createdAt FROM durable_job_events WHERE job_id=? AND sequence>? ORDER BY sequence"
    )
    .all(input.id, event.sequence)
    .map(parseEvent)
  return { kind: "events", events }
}
