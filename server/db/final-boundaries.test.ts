import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  DurableJobCreateSchema,
  ProviderKindSchema,
  RunnerNameSchema,
  createPersistence,
  type Persistence
} from "../src/db/index"

const directories: string[] = []
const timestamp = "2026-08-26T12:00:00.000Z"
const hash = (character: string): string => character.repeat(64)
const createPersistenceForTest = (): Persistence => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "interview-helper-final-boundaries-"))
  directories.push(dataDirectory)
  return createPersistence({ dataDirectory })
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

test("rejects secret capabilities from persisted settings and runner rows", () => {
  const persistence = createPersistenceForTest()
  const settingsKind = ProviderKindSchema.parse("raw-settings")
  const runnerName = RunnerNameSchema.parse("raw-runner")
  persistence.database.run(
    "INSERT INTO provider_settings (provider_kind,selected_model,enabled,capability_json,updated_at) VALUES (?,?,?,?,?)",
    [settingsKind, null, 1, '{"token":"canary-settings"}', timestamp]
  )
  persistence.database.run(
    "INSERT INTO runner_registrations (id,runner_name,token_hash,capability_json,status,registered_at,last_seen_at,revoked_at) VALUES (?,?,?,?,?,?,?,?)",
    [
      crypto.randomUUID(),
      runnerName,
      hash("a"),
      '{"token":"canary-runner"}',
      "active",
      timestamp,
      timestamp,
      null
    ]
  )

  expect(() => persistence.repositories.operations.getProviderSettings(settingsKind)).toThrow()
  expect(() => persistence.repositories.operations.getRunnerRegistration(runnerName)).toThrow()
  persistence.close()
})

test("enforces exhaustive durable state invariants in Zod and SQLite", () => {
  const persistence = createPersistenceForTest()
  const valid = [
    {
      state: "queued",
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCode: null,
      errorMessage: null
    },
    {
      state: "leased",
      leaseOwner: "runner-a",
      leaseExpiresAt: timestamp,
      errorCode: null,
      errorMessage: null
    },
    {
      state: "running",
      leaseOwner: "runner-a",
      leaseExpiresAt: timestamp,
      errorCode: null,
      errorMessage: null
    },
    {
      state: "succeeded",
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCode: null,
      errorMessage: null
    },
    {
      state: "failed",
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCode: "provider_error",
      errorMessage: "unavailable"
    },
    {
      state: "cancelled",
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCode: null,
      errorMessage: null
    }
  ] as const
  for (const fields of valid)
    expect(() =>
      DurableJobCreateSchema.parse({
        id: crypto.randomUUID(),
        kind: "work",
        idempotencyKey: crypto.randomUUID(),
        payload: {},
        ...fields
      })
    ).not.toThrow()
  expect(() =>
    DurableJobCreateSchema.parse({
      id: crypto.randomUUID(),
      kind: "work",
      state: "succeeded",
      idempotencyKey: crypto.randomUUID(),
      payload: {},
      leaseOwner: "runner-a",
      leaseExpiresAt: timestamp,
      errorCode: null,
      errorMessage: null
    })
  ).toThrow()
  expect(() =>
    persistence.database.run(
      "INSERT INTO durable_jobs (id,kind,state,idempotency_key,payload_json,lease_owner,lease_expires_at,error_code,error_message,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [
        crypto.randomUUID(),
        "work",
        "failed",
        crypto.randomUUID(),
        "{}",
        null,
        null,
        null,
        null,
        timestamp,
        timestamp
      ]
    )
  ).toThrow()
  persistence.close()
})

test("preserves revoked runners and rejects invalid disclosure arrays", () => {
  const persistence = createPersistenceForTest()
  const { operations } = persistence.repositories
  const runner = operations.upsertRunnerRegistration({
    id: crypto.randomUUID(),
    runnerName: "runner-a",
    tokenHash: hash("b"),
    capabilities: {},
    status: "revoked",
    registeredAt: timestamp,
    lastSeenAt: timestamp,
    revokedAt: timestamp
  })
  expect(() =>
    operations.upsertRunnerRegistration({
      ...runner,
      id: crypto.randomUUID(),
      tokenHash: hash("c"),
      status: "active",
      revokedAt: null
    })
  ).toThrow()
  expect(operations.getRunnerRegistration(runner.runnerName)).toEqual(runner)
  const settings = operations.upsertProviderSettings({
    providerKind: "openai",
    selectedModel: null,
    enabled: true,
    capabilities: {},
    updatedAt: timestamp
  })
  const disclosure = operations.recordDisclosure({
    id: crypto.randomUUID(),
    requestHash: hash("d"),
    providerKind: settings.providerKind,
    destination: "https://provider.example",
    action: "send",
    actionAt: timestamp,
    selectedInputHashes: [hash("e"), hash("f")]
  })
  expect(disclosure.selectedInputHashes).toEqual([hash("e"), hash("f")])
  expect(() =>
    persistence.database.run("UPDATE outbound_disclosures SET selected_input_hashes=? WHERE id=?", [
      "[]",
      disclosure.id
    ])
  ).toThrow()
  for (const selectedInputHashes of ["[]", `["${hash("d")}","${hash("d")}"]`, '["bad"]'])
    expect(() =>
      persistence.database.run(
        "INSERT INTO outbound_disclosures (id,request_hash,provider_kind,destination,action,action_at,selected_input_hashes) VALUES (?,?,?,?,?,?,?)",
        [
          crypto.randomUUID(),
          crypto.randomUUID().replaceAll("-", "").repeat(2),
          settings.providerKind,
          "https://provider.example",
          "send",
          timestamp,
          selectedInputHashes
        ]
      )
    ).toThrow()
  persistence.close()
})

test("returns exact declared JobPost fields through create and get", () => {
  const persistence = createPersistenceForTest()
  const jobPost = persistence.repositories.domain.createJobPost({
    id: crypto.randomUUID(),
    title: "Engineer",
    companyName: "Example"
  })
  expect(Object.keys(jobPost).sort()).toEqual(["companyName", "id", "title"])
  expect(Object.keys(persistence.repositories.domain.getJobPost(jobPost.id) ?? {}).sort()).toEqual([
    "companyName",
    "id",
    "title"
  ])
  persistence.close()
})
