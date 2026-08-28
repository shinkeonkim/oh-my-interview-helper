import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPersistence } from "../src/db"

const reservePort = (): number => {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open() {}, data() {} } })
  const port = listener.port
  listener.stop()
  return port
}

const waitFor = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  markers: readonly string[]
): Promise<void> => {
  const decoder = new TextDecoder()
  let output = ""
  while (!markers.every((marker) => output.includes(marker))) {
    const chunk = await reader.read()
    if (chunk.done) throw new Error("Process exited before scheduler readiness")
    output += decoder.decode(chunk.value)
  }
}

const run = async (
  kind: "manual.blocking" | "manual.external",
  expected: "queued" | "failed"
): Promise<void> => {
  const directory = mkdtempSync(join(tmpdir(), "scheduler-sigterm-"))
  const persistence = createPersistence({ dataDirectory: directory })
  const job = persistence.repositories.jobs.enqueue({
    id: crypto.randomUUID(),
    kind,
    input: {},
    idempotencyKey: crypto.randomUUID(),
    retryClass: kind === "manual.blocking" ? "local" : "external",
    maxAttempts: kind === "manual.blocking" ? 2 : 1,
    now: new Date().toISOString()
  }).job
  persistence.close()
  const port = reservePort()
  const child = Bun.spawn(["bun", "server/jobs/manual-server-harness.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: directory, PORT: String(port) },
    stdout: "pipe",
    stderr: "pipe"
  })
  const reader = child.stdout.getReader()
  await waitFor(reader, [
    "HARNESS_SIGNAL_READY",
    `HANDLER_STARTED ${kind === "manual.blocking" ? "blocking" : "external"} ${job.id}`
  ])
  child.kill("SIGTERM")
  expect(await child.exited).toBe(0)
  await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow()
  const reopened = createPersistence({ dataDirectory: directory })
  const stored = reopened.repositories.jobs.get({ id: job.id })
  expect(stored).toMatchObject({
    state: expected,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorCode: "interrupted"
  })
  expect(
    reopened.repositories.jobs.events({ id: job.id }).filter((event) => event.kind === "succeeded")
  ).toHaveLength(0)
  const attempts = readFileSync(
    join(
      directory,
      `manual-${kind === "manual.blocking" ? "blocking" : "external"}-${job.id}.attempt`
    ),
    "utf8"
  )
  expect(attempts.trim()).toBe("1")
  reopened.close()
  rmSync(directory, { recursive: true, force: true })
}

test(
  "persists interrupted local work when SIGTERM-aware handler returns",
  () => run("manual.blocking", "queued"),
  10_000
)
test(
  "fails interrupted external work once on SIGTERM",
  () => run("manual.external", "failed"),
  10_000
)
