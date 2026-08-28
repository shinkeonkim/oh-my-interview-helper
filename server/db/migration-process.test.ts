import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("serializes fresh migrations across real Bun processes", async () => {
  // Given
  const dataDirectory = mkdtempSync(join(tmpdir(), "migration-process-"))
  const first = Bun.spawn(["bun", "server/src/db/process-open.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: dataDirectory },
    stderr: "pipe"
  })
  const second = Bun.spawn(["bun", "server/src/db/process-open.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: dataDirectory },
    stderr: "pipe"
  })

  // When
  const [firstExit, secondExit] = await Promise.all([first.exited, second.exited])

  // Then
  expect([firstExit, secondExit]).toEqual([0, 0])
  rmSync(dataDirectory, { recursive: true, force: true })
}, 10_000)
