import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  applyMigrations,
  createPersistence,
  DocumentCreateSchema,
  MigrationFailureError,
  type Migration
} from "../src/db/index"

const temporaryDirectories: string[] = []
const makeDataDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-db-"))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { force: true, recursive: true })
})

describe("local SQLite persistence", () => {
  test("migrates a clean database idempotently with WAL and foreign keys", () => {
    // Given
    const dataDirectory = makeDataDirectory()

    // When
    const first = createPersistence({ dataDirectory })
    const second = createPersistence({ dataDirectory })

    // Then
    expect(
      first.database.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode
    ).toBe("wal")
    expect(
      first.database.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()?.foreign_keys
    ).toBe(1)
    expect(
      second.database
        .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM schema_migrations")
        .get()?.count
    ).toBeGreaterThan(0)
    first.close()
    second.close()
  })

  test("rolls back malformed migrations and refuses checksum drift without partial history", () => {
    // Given
    const persistence = createPersistence({ dataDirectory: makeDataDirectory(), migrations: [] })
    const malformed: readonly Migration[] = [
      { id: "9000_bad", sql: "CREATE TABLE transient_state (id TEXT); NOT SQL" }
    ]

    // When
    expect(() => applyMigrations(persistence.database, malformed)).toThrow(MigrationFailureError)

    // Then
    expect(
      persistence.database
        .query("SELECT name FROM sqlite_master WHERE name = 'transient_state'")
        .get()
    ).toBeNull()
    expect(
      persistence.database
        .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM schema_migrations")
        .get()?.count
    ).toBe(0)
    applyMigrations(persistence.database, [
      { id: "9000_good", sql: "CREATE TABLE stable_state (id TEXT)" }
    ])
    expect(() =>
      applyMigrations(persistence.database, [
        { id: "9000_good", sql: "CREATE TABLE changed_state (id TEXT)" }
      ])
    ).toThrow(MigrationFailureError)
    persistence.close()
  })

  test("rolls back repository transactions and parses branded document boundaries", () => {
    // Given
    const persistence = createPersistence({ dataDirectory: makeDataDirectory() })
    const document = DocumentCreateSchema.parse({
      id: crypto.randomUUID(),
      kind: "resume",
      title: "Resume"
    })

    // When
    expect(() =>
      persistence.repositories.transaction(() => {
        persistence.repositories.documents.create(document)
        throw new Error("rollback")
      })
    ).toThrow("rollback")

    // Then
    expect(persistence.repositories.documents.get(document.id)).toBeNull()
    expect(() =>
      DocumentCreateSchema.parse({ id: "not-a-uuid", kind: "resume", title: "Resume" })
    ).toThrow()
    persistence.close()
  })

  test("persists linked versioned domain fixtures across reopen", async () => {
    // Given
    const dataDirectory = makeDataDirectory()
    const persistence = createPersistence({ dataDirectory })
    const document = DocumentCreateSchema.parse({
      id: crypto.randomUUID(),
      kind: "resume",
      title: "Resume"
    })
    const hash = await persistence.blobs.put(new Blob(["resume bytes"]), "text/plain")
    persistence.repositories.blobs.register(hash)

    // When
    persistence.repositories.documents.create(document)
    persistence.repositories.documents.addVersion({
      id: crypto.randomUUID(),
      documentId: document.id,
      blobHash: hash.sha256
    })
    persistence.close()
    const reopened = createPersistence({ dataDirectory })

    // Then
    expect(reopened.repositories.documents.get(document.id)?.currentVersion?.blobHash).toBe(
      hash.sha256
    )
    reopened.close()
  })

  test("persists typed approved-domain records without fixture APIs", () => {
    // Given
    const persistence = createPersistence({ dataDirectory: makeDataDirectory() })

    // When
    const jobPost = persistence.repositories.domain.createJobPost({
      id: crypto.randomUUID(),
      title: "Engineer",
      companyName: "Example"
    })

    // Then
    expect(persistence.repositories.domain.getJobPost(jobPost.id)?.title).toBe("Engineer")
    persistence.close()
  })

  test("rejects a 64-character non-hex blob hash at the SQLite boundary", () => {
    // Given
    const persistence = createPersistence({ dataDirectory: makeDataDirectory() })

    // When / Then
    expect(() =>
      persistence.database.run(
        "INSERT INTO blobs (sha256,byte_size,media_type,created_at) VALUES (?,?,?,?)",
        ["g".repeat(64), 1, "text/plain", new Date().toISOString()]
      )
    ).toThrow()
    persistence.close()
  })

  test("persists immutable job-post versions and application event history", () => {
    // Given
    const persistence = createPersistence({ dataDirectory: makeDataDirectory() })
    const post = persistence.repositories.domain.createJobPost({
      id: crypto.randomUUID(),
      title: "Engineer",
      companyName: "Example"
    })

    // When
    const version = persistence.repositories.domain.addJobPostVersion({
      id: crypto.randomUUID(),
      jobPostId: post.id,
      sourceKind: "manual",
      content: { location: "Seoul" }
    })
    const application = persistence.repositories.domain.createApplication({
      id: crypto.randomUUID(),
      jobPostId: post.id,
      idempotencyKey: crypto.randomUUID()
    })
    persistence.repositories.domain.appendApplicationEvent({
      id: crypto.randomUUID(),
      applicationId: application.id,
      kind: "applied",
      payload: { stage: "applied" }
    })

    // Then
    expect(persistence.repositories.domain.listJobPostVersions(post.id)).toEqual([version])
    expect(persistence.repositories.domain.listApplicationEvents(application.id)).toHaveLength(1)
    persistence.close()
  })

  test("rejects duplicate application idempotency and exposes application reads", () => {
    // Given
    const persistence = createPersistence({ dataDirectory: makeDataDirectory() })
    const post = persistence.repositories.domain.createJobPost({
      id: crypto.randomUUID(),
      title: "Engineer",
      companyName: "Example"
    })
    const key = crypto.randomUUID()
    const application = persistence.repositories.domain.createApplication({
      id: crypto.randomUUID(),
      jobPostId: post.id,
      idempotencyKey: key
    })

    // When / Then
    expect(persistence.repositories.domain.getApplication(application.id)?.id).toBe(application.id)
    expect(persistence.repositories.domain.listApplications()).toHaveLength(1)
    expect(() =>
      persistence.repositories.domain.createApplication({
        id: crypto.randomUUID(),
        jobPostId: post.id,
        idempotencyKey: key
      })
    ).toThrow()
    persistence.close()
  })
})
