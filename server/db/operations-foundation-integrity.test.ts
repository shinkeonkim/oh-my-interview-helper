import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPersistence, type Persistence } from "../src/db/index"

const temporaryDirectories: string[] = []
const timestamp = "2026-08-26T12:00:00.000Z"
const nextHash = (character: string): string => character.repeat(64)

const createOperations = (): Persistence => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "interview-helper-operations-foundation-"))
  temporaryDirectories.push(dataDirectory)
  return createPersistence({ dataDirectory })
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { force: true, recursive: true })
})

test("enforces durable lease errors, disclosures, runner hashes, and ordered events", () => {
  // Given
  const persistence = createOperations()
  const { operations } = persistence.repositories
  const settings = operations.upsertProviderSettings({
    providerKind: "openai",
    selectedModel: "gpt-5.6",
    enabled: true,
    capabilities: { structuredOutput: true },
    updatedAt: timestamp
  })
  const jobInput = {
    id: crypto.randomUUID(),
    kind: "research",
    state: "leased",
    idempotencyKey: crypto.randomUUID(),
    payload: { source: "manual" },
    leaseOwner: "runner-a",
    leaseExpiresAt: "2026-08-26T12:05:00.000Z",
    errorCode: null,
    errorMessage: null
  }
  const job = operations.createJob(jobInput)

  // When
  const firstEvent = operations.appendJobEvent({
    id: crypto.randomUUID(),
    jobId: job.id,
    kind: "leased",
    payload: { owner: "runner-a" }
  })
  const secondEvent = operations.appendJobEvent({
    id: crypto.randomUUID(),
    jobId: job.id,
    kind: "running",
    payload: {}
  })
  const disclosure = operations.recordDisclosure({
    id: crypto.randomUUID(),
    requestHash: nextHash("a"),
    providerKind: settings.providerKind,
    destination: "https://provider.example/disclose",
    action: "generate_cover_letter",
    actionAt: timestamp,
    selectedInputHashes: [nextHash("b")]
  })
  const runner = operations.upsertRunnerRegistration({
    id: crypto.randomUUID(),
    runnerName: "runner-a",
    tokenHash: nextHash("c"),
    capabilities: { concurrency: 1 },
    status: "active",
    registeredAt: timestamp,
    lastSeenAt: timestamp,
    revokedAt: null
  })

  // Then
  expect([firstEvent.sequence, secondEvent.sequence]).toEqual([1, 2])
  expect(operations.getJob(job.id)).toEqual(job)
  expect(operations.getDisclosure(disclosure.id)).toEqual(disclosure)
  expect(operations.getRunnerRegistration(runner.runnerName)).toEqual(runner)
  expect(() =>
    operations.createJob({
      ...jobInput,
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      leaseOwner: null
    })
  ).toThrow()
  expect(() =>
    operations.createJob({
      ...jobInput,
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      errorCode: "provider_error",
      errorMessage: "token=canary-raw-token"
    })
  ).toThrow()
  expect(() =>
    operations.recordDisclosure({
      ...disclosure,
      id: crypto.randomUUID(),
      requestHash: nextHash("d"),
      selectedInputHashes: [nextHash("e"), nextHash("e")]
    })
  ).toThrow()
  expect(() =>
    persistence.database.run(
      "INSERT INTO outbound_disclosures (id,request_hash,provider_kind,destination,action,action_at,selected_input_hashes) VALUES (?,?,?,?,?,?,?)",
      [
        crypto.randomUUID(),
        nextHash("f"),
        settings.providerKind,
        "https://provider.example/disclose",
        "probe",
        timestamp,
        '["not-a-hash"]'
      ]
    )
  ).toThrow()
  expect(() =>
    persistence.database.run(
      "INSERT INTO runner_registrations (id,runner_name,token_hash,capability_json,status,registered_at,last_seen_at,revoked_at) VALUES (?,?,?,?,?,?,?,?)",
      [crypto.randomUUID(), "runner-b", "A".repeat(64), "{}", "active", timestamp, timestamp, null]
    )
  ).toThrow()
  expect(() =>
    persistence.database.run(
      "INSERT INTO durable_job_events (id,job_id,sequence,event_kind,payload_json,created_at) VALUES (?,?,?,?,?,?)",
      [crypto.randomUUID(), job.id, 1, "duplicate", "{}", timestamp]
    )
  ).toThrow()
  persistence.close()
})
