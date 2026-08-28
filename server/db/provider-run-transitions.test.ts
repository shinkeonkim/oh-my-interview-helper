import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPersistence, type Persistence } from "../src/db"

const handles: Persistence[] = []
const directories: string[] = []
const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), "provider-run-transitions-"))
  directories.push(directory)
  const persistence = createPersistence({ dataDirectory: directory })
  handles.push(persistence)
  return persistence.repositories.providerArtifacts
}
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

test("transitions a running provider run exactly once without mutable request provenance", () => {
  // Given
  const repository = fixture()
  const running = repository.createRunning({
    id: crypto.randomUUID(),
    providerKind: "fake",
    mode: "completion",
    model: "fake-model",
    requestHash: "a".repeat(64)
  })

  // When
  const completed = repository.completeProviderRun(
    running.id,
    { inputTokens: 3, outputTokens: 2, cacheTokens: 0, totalTokens: 5 },
    null
  )

  // Then
  expect(completed).toMatchObject({
    status: "succeeded",
    requestHash: running.requestHash,
    model: "fake-model"
  })
  expect(() => repository.completeProviderRun(running.id, null, null)).toThrow(
    "PROVIDER_RUN_TRANSITION_INVALID"
  )
})

test("database triggers reject invalid running transitions and terminal mutation", () => {
  // Given
  const repository = fixture()
  const running = repository.createRunning({
    id: crypto.randomUUID(),
    providerKind: "fake",
    mode: "completion",
    model: "fake-model",
    requestHash: "b".repeat(64)
  })

  // When / Then
  expect(() =>
    handles[0]?.database.run("UPDATE provider_runs SET status='queued' WHERE id=?", [running.id])
  ).toThrow("provider run transition invalid")
  repository.cancelProviderRun(running.id, null, null)
  expect(() =>
    handles[0]?.database.run("UPDATE provider_runs SET request_hash=? WHERE id=?", [
      "c".repeat(64),
      running.id
    ])
  ).toThrow("terminal provider run is immutable")
  expect(() =>
    repository.failProviderRun(running.id, null, null, { category: "timeout", retryable: false })
  ).toThrow("PROVIDER_RUN_TRANSITION_INVALID")
})
