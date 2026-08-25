import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPersistence } from "../src/db"
import { migrations } from "../src/db/schema"

test("upgrades a pre-scheduling database and preserves fresh scheduling invariants", () => {
  // Given
  const directory = mkdtempSync(join(tmpdir(), "scheduler-migration-"))
  const legacy = createPersistence({ dataDirectory: directory, migrations: migrations.slice(0, 3) })
  legacy.close()

  // When
  const upgraded = createPersistence({ dataDirectory: directory })
  const columns = upgraded.database
    .query<{ readonly name: string }, []>("PRAGMA table_info(durable_jobs)")
    .all()
  const job = upgraded.repositories.jobs.enqueue({
    id: crypto.randomUUID(),
    kind: "local",
    input: {},
    idempotencyKey: crypto.randomUUID(),
    retryClass: "local",
    maxAttempts: 2,
    now: "2026-08-26T12:00:00.000Z"
  }).job

  // Then
  expect(columns.map((column) => column.name)).toEqual(
    expect.arrayContaining([
      "retry_class",
      "attempt_count",
      "next_attempt_at",
      "cancellation_requested_at"
    ])
  )
  expect(job).toMatchObject({ state: "queued", retryClass: "local", attemptCount: 0 })
  upgraded.close()
  rmSync(directory, { force: true, recursive: true })
})

test("upgrades every Todo 5 migration boundary without gaps or cursor drift", () => {
  // Given
  const directories = [3, 4, 5, 6].map(() => mkdtempSync(join(tmpdir(), "scheduler-migration-")))

  // When / Then
  for (const [index, directory] of directories.entries()) {
    const boundary = index + 3
    const legacy = createPersistence({
      dataDirectory: directory,
      migrations: migrations.slice(0, boundary)
    })
    const id = crypto.randomUUID()
    legacy.database.run(
      "INSERT INTO durable_jobs (id,kind,state,idempotency_key,payload_json,lease_owner,lease_expires_at,error_code,error_message,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        "legacy",
        "queued",
        crypto.randomUUID(),
        "{}",
        null,
        null,
        null,
        null,
        "2026-08-26T12:00:00.000Z",
        "2026-08-26T12:00:00.000Z"
      ]
    )
    legacy.database.run(
      "INSERT INTO durable_job_events (id,job_id,sequence,event_kind,payload_json,created_at) VALUES (?,?,?,?,?,?)",
      [crypto.randomUUID(), id, 1, "queued", '{"state":"queued"}', "2026-08-26T12:00:00.000Z"]
    )
    legacy.close()

    const upgraded = createPersistence({ dataDirectory: directory })
    expect(
      upgraded.database
        .query<{ readonly id: string }, []>("SELECT id FROM schema_migrations ORDER BY id")
        .all()
    ).toEqual(migrations.map((migration) => ({ id: migration.id })))
    expect(upgraded.repositories.jobs.get({ id })).toMatchObject({
      state: "queued",
      retryClass: "local",
      executionTarget: "app",
      attemptCount: 0
    })
    expect(
      upgraded.database
        .query<{ readonly nextSequence: number }, [string]>(
          "SELECT next_sequence nextSequence FROM durable_job_event_cursors WHERE job_id=?"
        )
        .get(id)
    ).toEqual({ nextSequence: 2 })
    upgraded.close()
  }

  const freshDirectory = mkdtempSync(join(tmpdir(), "scheduler-migration-fresh-"))
  const fresh = createPersistence({ dataDirectory: freshDirectory })
  expect(
    fresh.database
      .query<{ readonly id: string }, []>("SELECT id FROM schema_migrations ORDER BY id")
      .all()
  ).toEqual(migrations.map((migration) => ({ id: migration.id })))
  fresh.close()
  for (const directory of [...directories, freshDirectory])
    rmSync(directory, { force: true, recursive: true })
})
