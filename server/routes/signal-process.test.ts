import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("exits and closes its port after SIGTERM", async () => {
  // Given
  const dataDirectory = mkdtempSync(join(tmpdir(), "signal-process-"))
  const port = 43117
  const child = Bun.spawn(["bun", "server/src/index.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: dataDirectory, PORT: String(port) },
    stdout: "pipe",
    stderr: "pipe"
  })
  const reader = child.stdout.getReader()
  await reader.read()

  // When
  child.kill("SIGTERM")
  const exitCode = await child.exited

  // Then
  expect(exitCode).toBe(0)
  await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow()
  rmSync(dataDirectory, { recursive: true, force: true })
}, 10_000)
