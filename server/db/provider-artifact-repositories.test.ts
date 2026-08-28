import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

import {
  ArtifactCreateSchema,
  ArtifactInputCreateSchema,
  ProviderArtifactRepository,
  ProviderRunCreateSchema,
  type ProviderArtifactRepository as ProviderArtifactRepositoryType
} from "../src/db/provider-artifact-repositories"
import { DocumentIdSchema, DocumentVersionIdSchema } from "../src/db/ids"
import { createPersistence, type Persistence } from "../src/db/index"

const directories: string[] = []
const handles: Persistence[] = []

const createFixture = (): {
  readonly persistence: Persistence
  readonly repository: ProviderArtifactRepositoryType
} => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "interview-helper-provider-artifact-"))
  directories.push(dataDirectory)
  const persistence = createPersistence({ dataDirectory })
  handles.push(persistence)
  return { persistence, repository: new ProviderArtifactRepository(persistence.database) }
}

const requestHash = (): string => crypto.randomUUID().replaceAll("-", "").repeat(2)
const providerRun = () =>
  ProviderRunCreateSchema.parse({
    id: crypto.randomUUID(),
    providerKind: "openai",
    mode: "chat",
    model: "gpt-4.1",
    requestHash: requestHash(),
    status: "succeeded",
    usage: { inputTokens: 120, outputTokens: 36 },
    cost: { currency: "USD", microunits: 840 },
    error: null,
    completedAt: new Date().toISOString()
  })
const artifact = (providerRunId: ReturnType<typeof providerRun>["id"], version: number) =>
  ArtifactCreateSchema.parse({
    id: crypto.randomUUID(),
    kind: "cover_letter",
    status: "draft",
    providerRunId,
    version,
    content: { sections: [{ heading: "Opening", text: "Evidence-led" }] }
  })

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe("provider artifact repositories", () => {
  test("persists typed provider mode, model, status, and nullable usage or cost", () => {
    // Given
    const { repository } = createFixture()
    const succeeded = providerRun()
    const failed = ProviderRunCreateSchema.parse({
      ...providerRun(),
      status: "failed",
      usage: null,
      cost: null,
      error: { category: "provider_unavailable", retryable: true },
      completedAt: new Date().toISOString()
    })

    // When
    repository.createProviderRun(succeeded)
    repository.createProviderRun(failed)

    // Then
    expect(repository.getProviderRun(succeeded.id)).toEqual(succeeded)
    expect(repository.getProviderRun(failed.id)).toEqual(failed)
    expect(repository.listProviderRuns()).toEqual(expect.arrayContaining([succeeded, failed]))
    expect(failed.usage).toBeNull()
    expect(failed.cost).toBeNull()
    expect(() =>
      repository.createProviderRun(
        ProviderRunCreateSchema.parse({ ...succeeded, id: crypto.randomUUID() })
      )
    ).toThrow()
  })

  test("accepts only sanitized provider failure metadata", () => {
    // Given / When / Then
    expect(() =>
      ProviderRunCreateSchema.parse({
        ...providerRun(),
        status: "failed",
        error: {
          category: "provider_unavailable",
          retryable: true,
          providerMessage: "Do not persist provider response bodies"
        },
        completedAt: new Date().toISOString()
      })
    ).toThrow(z.ZodError)
  })

  test("keeps artifact kind versions immutable and rejects duplicate IDs or versions", () => {
    // Given
    const { repository } = createFixture()
    const run = providerRun()
    repository.createProviderRun(run)
    const first = artifact(run.id, 1)
    const second = artifact(run.id, 2)

    // When
    repository.createArtifact(first)
    repository.createArtifact(second)

    // Then
    expect(repository.getArtifact(first.id)).toEqual(first)
    expect(repository.listArtifacts("cover_letter")).toEqual([first, second])
    expect(() => repository.createArtifact({ ...second, id: first.id })).toThrow()
    expect(() =>
      repository.createArtifact(
        ArtifactCreateSchema.parse({ ...second, id: crypto.randomUUID(), version: 1 })
      )
    ).toThrow()
  })

  test("requires structured artifact content and valid artifact lifecycle values", () => {
    // Given
    const run = providerRun()

    // When / Then
    expect(() =>
      ArtifactCreateSchema.parse({ ...artifact(run.id, 1), status: "published" })
    ).toThrow(z.ZodError)
    expect(() =>
      ArtifactCreateSchema.parse({
        ...artifact(run.id, 1),
        kind: "unknown",
        content: ["not structured"]
      })
    ).toThrow(z.ZodError)
  })

  test("records exactly one typed input provenance source and preserves its linkage", () => {
    // Given
    const { persistence, repository } = createFixture()
    const run = providerRun()
    repository.createProviderRun(run)
    const created = artifact(run.id, 1)
    repository.createArtifact(created)
    const documentId = DocumentIdSchema.parse(crypto.randomUUID())
    const documentVersionId = DocumentVersionIdSchema.parse(crypto.randomUUID())
    const blobHash = "a".repeat(64)
    persistence.database.run(
      "INSERT INTO blobs (sha256,byte_size,media_type,created_at) VALUES (?,?,?,?)",
      [blobHash, 1, "text/plain", new Date().toISOString()]
    )
    persistence.database.run("INSERT INTO documents (id,kind,title,created_at) VALUES (?,?,?,?)", [
      documentId,
      "resume",
      "Resume",
      new Date().toISOString()
    ])
    persistence.database.run(
      "INSERT INTO document_versions (id,document_id,version_number,blob_hash,created_at) VALUES (?,?,?,?,?)",
      [documentVersionId, documentId, 1, blobHash, new Date().toISOString()]
    )
    const input = ArtifactInputCreateSchema.parse({
      artifactId: created.id,
      source: { kind: "document_version", documentVersionId }
    })

    // When
    repository.createArtifactInput(input)

    // Then
    expect(repository.getArtifactInput(created.id, "document_version")).toEqual(input)
    expect(repository.listArtifactInputs(created.id)).toEqual([input])
    expect(() =>
      ArtifactInputCreateSchema.parse({
        artifactId: created.id,
        source: { kind: "source_hash", sourceHash: blobHash, documentVersionId }
      })
    ).toThrow(z.ZodError)
    expect(() => repository.createArtifactInput(input)).toThrow()
  })

  test("rejects malformed database JSON, status, and foreign-key relationships", () => {
    // Given
    const { persistence, repository } = createFixture()
    const missingRunId = providerRun().id
    const invalidStatus = providerRun()

    // When / Then
    expect(() => repository.createArtifact(artifact(missingRunId, 1))).toThrow()
    expect(() =>
      persistence.database.run(
        "INSERT INTO provider_runs (id,provider_kind,status,request_hash,usage_json,created_at) VALUES (?,?,?,?,?,?)",
        [
          invalidStatus.id,
          "openai",
          "succeeded",
          requestHash(),
          "not-json",
          new Date().toISOString()
        ]
      )
    ).toThrow()
    expect(() =>
      persistence.database.run(
        "INSERT INTO provider_runs (id,provider_kind,status,request_hash,created_at) VALUES (?,?,?,?,?)",
        [crypto.randomUUID(), "openai", "invalid", requestHash(), new Date().toISOString()]
      )
    ).toThrow()
  })

  test("rolls back composed provider artifact writes and rejects malformed stored rows", () => {
    // Given
    const { persistence, repository } = createFixture()
    const run = providerRun()
    const created = artifact(run.id, 1)
    const malformedStatus = providerRun()

    // When
    expect(() =>
      repository.transaction(() => {
        repository.createProviderRun(run)
        repository.createArtifact(created)
        throw new Error("rollback")
      })
    ).toThrow("rollback")
    persistence.database.run("PRAGMA ignore_check_constraints = ON")
    persistence.database.run(
      "INSERT INTO provider_runs (id,provider_kind,status,request_hash,usage_json,created_at) VALUES (?,?,?,?,?,?)",
      [run.id, "openai", "succeeded", requestHash(), "not-json", new Date().toISOString()]
    )
    persistence.database.run(
      "INSERT INTO provider_runs (id,provider_kind,status,request_hash,usage_json,created_at) VALUES (?,?,?,?,?,?)",
      [
        malformedStatus.id,
        malformedStatus.providerKind,
        "invalid",
        requestHash(),
        JSON.stringify({
          mode: malformedStatus.mode,
          model: malformedStatus.model,
          usage: malformedStatus.usage,
          cost: malformedStatus.cost,
          error: malformedStatus.error
        }),
        new Date().toISOString()
      ]
    )
    persistence.database.run("PRAGMA ignore_check_constraints = OFF")

    // Then
    expect(repository.getArtifact(created.id)).toBeNull()
    expect(() => repository.getProviderRun(run.id)).toThrow(z.ZodError)
    expect(() => repository.getProviderRun(malformedStatus.id)).toThrow(z.ZodError)
  })
})
