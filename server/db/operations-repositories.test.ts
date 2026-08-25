import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

import { createPersistence } from "../src/db/index"
import { OperationsRepositories } from "../src/db/operations-repositories"

const temporaryDirectories: string[] = []
const makeDataDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-operations-"))
  temporaryDirectories.push(directory)
  return directory
}

const timestamp = "2026-08-26T12:00:00.000Z"
const nextHash = (character: string): string => character.repeat(64)
const createOperations = (): {
  readonly operations: OperationsRepositories
  readonly close: () => void
} => {
  const persistence = createPersistence({ dataDirectory: makeDataDirectory() })
  return { operations: new OperationsRepositories(persistence.database), close: persistence.close }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { force: true, recursive: true })
})

describe("operations repositories", () => {
  test("persists durable job metadata by idempotency key with nullable leases", () => {
    // Given
    const { operations, close } = createOperations()
    const input = {
      id: crypto.randomUUID(),
      kind: "resume_generation",
      state: "queued",
      idempotencyKey: crypto.randomUUID(),
      payload: { applicationId: crypto.randomUUID() },
      leaseOwner: null,
      leaseExpiresAt: null
    }

    // When
    const created = operations.createJob(input)

    // Then
    expect(operations.getJob(created.id)).toEqual(created)
    expect(operations.getJobByIdempotencyKey(created.idempotencyKey)).toEqual(created)
    expect(operations.listJobs()).toEqual([created])
    expect(created.leaseExpiresAt).toBeNull()
    expect(() => operations.createJob({ ...input, id: crypto.randomUUID() })).toThrow()
    expect(() => operations.createJob({ ...input, idempotencyKey: crypto.randomUUID() })).toThrow()
    close()
  })

  test("appends ordered immutable events and rejects missing job parents", () => {
    // Given
    const { operations, close } = createOperations()
    const job = operations.createJob({
      id: crypto.randomUUID(),
      kind: "research",
      state: "queued",
      idempotencyKey: crypto.randomUUID(),
      payload: {}
    })

    // When
    const queued = operations.appendJobEvent({
      id: crypto.randomUUID(),
      jobId: job.id,
      kind: "queued",
      payload: { source: "manual" }
    })
    const leased = operations.appendJobEvent({
      id: crypto.randomUUID(),
      jobId: job.id,
      kind: "leased",
      payload: { leaseExpiresAt: timestamp }
    })

    // Then
    expect([queued.sequence, leased.sequence]).toEqual([1, 2])
    expect(operations.listJobEvents(job.id)).toEqual([queued, leased])
    expect(() =>
      operations.appendJobEvent({
        id: crypto.randomUUID(),
        jobId: crypto.randomUUID(),
        kind: "missing-parent",
        payload: {}
      })
    ).toThrow()
    expect(() =>
      operations.appendJobEvent({ ...queued, id: queued.id, sequence: undefined })
    ).toThrow()
    close()
  })

  test("parses durable reads and rejects malformed statuses, hashes, and JSON", () => {
    // Given
    const { operations, close } = createOperations()
    const jobId = crypto.randomUUID()

    // When / Then
    expect(() =>
      operations.createJob({
        id: jobId,
        kind: "resume_generation",
        state: "unknown",
        idempotencyKey: crypto.randomUUID(),
        payload: {}
      })
    ).toThrow(z.ZodError)
    expect(() =>
      operations.recordDisclosure({
        id: crypto.randomUUID(),
        requestHash: "not-a-sha256",
        destination: "https://provider.example/disclose",
        confirmedAt: timestamp
      })
    ).toThrow(z.ZodError)
    operations.database.run("PRAGMA ignore_check_constraints = ON")
    operations.database.run(
      "INSERT INTO durable_jobs (id,kind,state,idempotency_key,payload_json,lease_expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      [
        jobId,
        "resume_generation",
        "unknown",
        crypto.randomUUID(),
        "not-json",
        null,
        timestamp,
        timestamp
      ]
    )
    const malformedJsonId = crypto.randomUUID()
    operations.database.run(
      "INSERT INTO durable_jobs (id,kind,state,idempotency_key,payload_json,lease_expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      [
        malformedJsonId,
        "resume_generation",
        "queued",
        crypto.randomUUID(),
        "not-json",
        null,
        timestamp,
        timestamp
      ]
    )
    operations.database.run("PRAGMA ignore_check_constraints = OFF")
    expect(() => operations.getJob(operations.parseJobId(jobId))).toThrow(z.ZodError)
    expect(() => operations.getJob(operations.parseJobId(malformedJsonId))).toThrow(z.ZodError)
    close()
  })

  test("upserts non-secret provider settings and rejects secret-like settings", () => {
    // Given
    const { operations, close } = createOperations()
    const providerKind = "openai"

    // When
    const first = operations.upsertProviderSettings({
      providerKind,
      selectedModel: "gpt-5.6",
      enabled: true,
      capabilities: { structuredOutput: true },
      updatedAt: timestamp
    })
    const replacement = operations.upsertProviderSettings({
      providerKind,
      selectedModel: null,
      enabled: false,
      capabilities: { structuredOutput: false, vision: true },
      updatedAt: "2026-08-26T12:01:00.000Z"
    })

    // Then
    expect(first.enabled).toBe(true)
    expect(operations.getProviderSettings(replacement.providerKind)).toEqual(replacement)
    expect(operations.listProviderSettings()).toEqual([replacement])
    expect(() =>
      operations.upsertProviderSettings({
        providerKind: "openai",
        selectedModel: "gpt-5.6",
        enabled: true,
        capabilities: { apiKey: "canary-provider-secret" },
        updatedAt: timestamp
      })
    ).toThrow(z.ZodError)
    close()
  })

  test("records disclosures and upserts hashed runner registrations without raw tokens", () => {
    // Given
    const { operations, close } = createOperations()
    const disclosure = {
      id: crypto.randomUUID(),
      requestHash: nextHash("a"),
      providerKind: "openai",
      destination: "https://provider.example/disclose",
      action: "disclose",
      actionAt: timestamp,
      selectedInputHashes: [nextHash("d")]
    }
    const registration = {
      id: crypto.randomUUID(),
      runnerName: "worker-a",
      tokenHash: nextHash("b"),
      capabilities: { concurrency: 1 },
      status: "active",
      registeredAt: timestamp,
      lastSeenAt: timestamp,
      revokedAt: null
    }
    operations.upsertProviderSettings({
      providerKind: disclosure.providerKind,
      selectedModel: "gpt-5.6",
      enabled: true,
      capabilities: { structuredOutput: true },
      updatedAt: timestamp
    })

    // When
    const recorded = operations.recordDisclosure(disclosure)
    const first = operations.upsertRunnerRegistration(registration)
    const revoked = operations.upsertRunnerRegistration({
      ...registration,
      id: crypto.randomUUID(),
      tokenHash: nextHash("c"),
      capabilities: { concurrency: 1 },
      status: "revoked",
      revokedAt: "2026-08-26T12:01:00.000Z"
    })

    // Then
    expect(operations.getDisclosure(recorded.id)).toEqual(recorded)
    expect(operations.listDisclosures()).toEqual([recorded])
    expect(() => operations.recordDisclosure({ ...disclosure, id: crypto.randomUUID() })).toThrow()
    expect(first.status).toBe("active")
    expect(revoked.id).toBe(first.id)
    expect(operations.getRunnerRegistration("worker-a")).toEqual(revoked)
    expect(() =>
      operations.upsertRunnerRegistration({ ...registration, token: "canary-raw-token" })
    ).toThrow(z.ZodError)
    expect(() =>
      operations.upsertRunnerRegistration({ ...registration, tokenHash: "not-a-sha256" })
    ).toThrow(z.ZodError)
    close()
  })
})
