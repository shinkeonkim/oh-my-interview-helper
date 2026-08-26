import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createProviderInvokeJobDefinition } from "../src/agents"
import { createPersistence, type Persistence } from "../src/db"
import { JobRuntime, createJobRegistry } from "../src/jobs/runtime"
import { JobScheduler } from "../src/jobs/scheduler"
import { kernelFor, registration, request } from "./contract-support"

const directories: string[] = []
const handles: Persistence[] = []
const requestHash = "a".repeat(64)
const usage = { inputTokens: 3, outputTokens: 2, cacheTokens: 1, totalTokens: 6 }

const setup = () => {
  const directory = mkdtempSync(join(tmpdir(), "provider-invoke-success-"))
  directories.push(directory)
  const persistence = createPersistence({ dataDirectory: directory })
  handles.push(persistence)
  const provider = registration([{ kind: "text", chunks: ["done"], usage }])
  const definition = createProviderInvokeJobDefinition({
    kernel: kernelFor(provider.registration),
    providerRuns: persistence.repositories.providerArtifacts,
    jobs: persistence.repositories.jobs,
    requests: { resolve: () => request }
  })
  const runtime = new JobRuntime(persistence.repositories.jobs, createJobRegistry([definition]))
  return { definition, persistence, runtime }
}

const enqueue = (runtime: JobRuntime) =>
  runtime.enqueue({
    kind: "provider-invoke",
    input: {
      runId: crypto.randomUUID(),
      providerId: "fake",
      mode: "test",
      model: "fake-model",
      requestHash
    },
    idempotencyKey: crypto.randomUUID()
  })

const runIdFor = (job: ReturnType<typeof enqueue>): string => {
  const runId = job.payload["runId"]
  if (typeof runId !== "string") throw new Error("Provider run id is missing")
  return runId
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

test("persists all usage components from a successful provider invoke job", async () => {
  // Given
  const harness = setup()
  const job = enqueue(harness.runtime)
  const scheduler = new JobScheduler(harness.runtime, { idleMilliseconds: 1 })
  let resolveTerminal: () => void = () => undefined
  const terminal = new Promise<void>((resolve) => {
    resolveTerminal = resolve
  })
  const unsubscribe = harness.runtime.subscribe(job.id, (event) => {
    if (["succeeded", "failed", "cancelled"].includes(event.kind)) resolveTerminal()
  })

  // When
  scheduler.start()
  await terminal
  unsubscribe()

  // Then
  expect(harness.persistence.repositories.jobs.get({ id: job.id })).toMatchObject({
    state: "succeeded"
  })
  expect(
    harness.persistence.repositories.providerArtifacts.getProviderRun(runIdFor(job))
  ).toMatchObject({ status: "succeeded", usage })
  await scheduler.stop()
})

test("drains a reported outcome when its provider run became terminal before the terminal hook", async () => {
  // Given
  const harness = setup()
  const job = enqueue(harness.runtime)
  const controller = new AbortController()
  if (harness.definition.terminal === undefined)
    throw new Error("Provider terminal hook is missing")

  // When
  await harness.definition.run({ job, signal: controller.signal })
  harness.persistence.repositories.providerArtifacts.completeProviderRun(runIdFor(job), usage, null)
  harness.definition.terminal({ job, state: "succeeded", reason: "succeeded" })

  // Then
  expect(harness.definition.pendingCount()).toBe(0)
})
