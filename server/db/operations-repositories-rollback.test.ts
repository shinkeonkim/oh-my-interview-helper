import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPersistence } from "../src/db/index"
import { OperationsRepositories } from "../src/db/operations-repositories"

test("rolls back grouped operations writes", () => {
  // Given
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-operations-rollback-"))
  const persistence = createPersistence({ dataDirectory: directory })
  const operations = new OperationsRepositories(persistence.database)
  const id = operations.parseJobId(crypto.randomUUID())

  // When
  expect(() =>
    operations.transaction(() => {
      operations.createJob({
        id,
        kind: "rollback",
        state: "queued",
        idempotencyKey: crypto.randomUUID(),
        payload: {},
        retryClass: "local",
        executionTarget: "app",
        maxAttempts: 1
      })
      throw new Error("rollback")
    })
  ).toThrow("rollback")

  // Then
  expect(operations.getJob(id)).toBeNull()
  persistence.close()
  rmSync(directory, { force: true, recursive: true })
})
