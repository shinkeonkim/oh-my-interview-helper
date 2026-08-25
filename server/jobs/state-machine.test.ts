import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPersistence } from "../src/db"
import { call, JobSchema, jobInput, jobRepository } from "./job-test-support"

const directories: string[] = []
const timestamp = "2026-08-26T12:00:00.000Z"
const later = "2026-08-26T12:00:01.000Z"
const expired = "2026-08-26T12:01:00.000Z"

const createJobs = (): { readonly close: () => void; readonly jobs: object } => {
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-jobs-state-"))
  directories.push(directory)
  const persistence = createPersistence({ dataDirectory: directory })
  return { close: persistence.close, jobs: jobRepository(persistence) }
}

const enqueue = (jobs: object, input = jobInput()): ReturnType<typeof JobSchema.parse> =>
  JobSchema.parse(call(jobs, "enqueue", { ...input, now: timestamp }).job)

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe("durable job state machine", () => {
  test("allows queued to leased to running to succeeded with one ordered terminal event", () => {
    // Given
    const { close, jobs } = createJobs()
    const queued = enqueue(jobs)

    // When
    const leased = JobSchema.parse(
      call(jobs, "claim", { owner: "worker-a", now: timestamp, leaseMilliseconds: 30_000 }).job
    )
    const running = JobSchema.parse(
      call(jobs, "start", { id: queued.id, owner: "worker-a", now: later }).job
    )
    const succeeded = JobSchema.parse(
      call(jobs, "succeed", { id: queued.id, owner: "worker-a", now: later }).job
    )

    // Then
    expect([leased.state, running.state, succeeded.state]).toEqual([
      "leased",
      "running",
      "succeeded"
    ])
    expect(call(jobs, "events", { id: queued.id })).toMatchObject([
      { kind: "queued", sequence: 1 },
      { kind: "leased", sequence: 2 },
      { kind: "running", sequence: 3 },
      { kind: "succeeded", sequence: 4 }
    ])
    close()
  })

  test("rejects illegal transitions and mutations of a terminal job atomically", () => {
    // Given
    const { close, jobs } = createJobs()
    const queued = enqueue(jobs)

    // When / Then
    expect(() => call(jobs, "succeed", { id: queued.id, owner: "worker-a", now: later })).toThrow(
      "JOB_TRANSITION_INVALID"
    )
    const cancelled = JobSchema.parse(call(jobs, "cancel", { id: queued.id, now: later }).job)
    expect(() =>
      call(jobs, "claim", { owner: "worker-a", now: later, leaseMilliseconds: 30_000 })
    ).toThrow("JOB_NOT_CLAIMABLE")
    expect(cancelled.state).toBe("cancelled")
    expect(JobSchema.parse(call(jobs, "get", { id: queued.id }))).toMatchObject({
      state: "cancelled"
    })
    close()
  })

  test("returns the same canonical job for duplicate idempotency and rejects divergent input", () => {
    // Given
    const { close, jobs } = createJobs()
    const input = jobInput()

    // When
    const first = enqueue(jobs, input)
    const replay = JobSchema.parse(call(jobs, "enqueue", { ...input, now: later }).job)

    // Then
    expect(replay).toMatchObject({ id: first.id, payload: first.payload })
    expect(() =>
      call(jobs, "enqueue", { ...input, input: { label: "changed" }, now: later })
    ).toThrow("IDEMPOTENCY_CONFLICT")
    close()
  })

  test("recovers an expired local lease by policy but fails an interrupted external job", () => {
    // Given
    const { close, jobs } = createJobs()
    const local = enqueue(jobs)
    const external = enqueue(jobs, {
      ...jobInput("test.external"),
      retryClass: "external",
      maxAttempts: 1
    })
    call(jobs, "claim", { owner: "worker-a", now: timestamp, leaseMilliseconds: 1 })
    call(jobs, "start", { id: local.id, owner: "worker-a", now: timestamp })
    call(jobs, "claim", { owner: "worker-a", now: timestamp, leaseMilliseconds: 1 })
    call(jobs, "start", { id: external.id, owner: "worker-a", now: timestamp })

    // When
    call(jobs, "recoverExpired", { now: expired })

    // Then
    expect(JobSchema.parse(call(jobs, "get", { id: local.id }))).toMatchObject({ state: "queued" })
    expect(JobSchema.parse(call(jobs, "get", { id: external.id }))).toMatchObject({
      state: "failed",
      errorCode: "interrupted"
    })
    close()
  })
})
