import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  ProviderKernel,
  ProviderRegistry,
  ToolRegistry,
  createProviderInvokeJobDefinition
} from "../src/agents"
import { createPersistence, type Persistence } from "../src/db"
import { JobRuntime, createJobRegistry } from "../src/jobs/runtime"
import { JobScheduler } from "../src/jobs/scheduler"
import { flush, ManualClock } from "../jobs/scheduler-test-support"

const directories: string[] = []
const handles: Persistence[] = []
const requestHash = "a".repeat(64)

const setup = (
  resolve: () => ReturnType<typeof unavailableInvocation>
): {
  readonly persistence: Persistence
  readonly runtime: JobRuntime
  readonly resolves: () => number
} => {
  const directory = mkdtempSync(join(tmpdir(), "provider-invoke-recovery-"))
  directories.push(directory)
  const persistence = createPersistence({ dataDirectory: directory })
  handles.push(persistence)
  let calls = 0
  const definition = createProviderInvokeJobDefinition({
    kernel: new ProviderKernel({
      providers: new ProviderRegistry([]),
      tools: new ToolRegistry([])
    }),
    providerRuns: persistence.repositories.providerArtifacts,
    jobs: persistence.repositories.jobs,
    requests: {
      resolve: () => {
        calls += 1
        return resolve()
      }
    }
  })
  return {
    persistence,
    runtime: new JobRuntime(persistence.repositories.jobs, createJobRegistry([definition])),
    resolves: () => calls
  }
}

const unavailableInvocation = () => ({
  providerId: "fake",
  messages: [{ role: "user" as const, content: [{ kind: "text" as const, text: "raw-canary" }] }],
  output: { kind: "text" as const },
  toolIds: []
})

const enqueue = (runtime: JobRuntime, runId = crypto.randomUUID()) =>
  runtime.enqueue({
    kind: "provider-invoke",
    input: { runId, providerId: "fake", mode: "test", model: "fake-model", requestHash },
    idempotencyKey: crypto.randomUUID()
  })

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

test("fails an unavailable production provider without resolving a raw request", async () => {
  // Given
  const harness = setup(unavailableInvocation)
  const job = enqueue(harness.runtime)
  const scheduler = new JobScheduler(harness.runtime, { idleMilliseconds: 1 })

  // When
  scheduler.start()
  await flush()

  // Then
  expect(harness.resolves()).toBe(0)
  expect(harness.persistence.repositories.jobs.get({ id: job.id })).toMatchObject({
    state: "failed",
    attemptCount: 1,
    errorCode: "handler_failed"
  })
  expect(
    harness.persistence.repositories.providerArtifacts.getProviderRun(job.payload["runId"])
  ).toMatchObject({
    status: "failed",
    error: { category: "provider_unavailable", retryable: false }
  })
  await scheduler.stop()
})

test("reconciles an interrupted external provider run without reinvoking it", async () => {
  // Given
  const harness = setup(unavailableInvocation)
  const clock = new ManualClock()
  const job = enqueue(harness.runtime)
  const runId = job.payload["runId"]
  if (typeof runId !== "string") throw new Error("Provider run id is missing")
  harness.persistence.repositories.providerArtifacts.createRunning({
    id: runId,
    providerKind: "fake",
    mode: "completion",
    model: "fake-model",
    requestHash
  })
  harness.persistence.repositories.jobs.claim({
    owner: "interrupted",
    now: clock.now().toISOString(),
    leaseMilliseconds: 1
  })
  harness.persistence.repositories.jobs.start({
    id: job.id,
    owner: "interrupted",
    now: clock.now().toISOString()
  })
  clock.advance(1)
  const scheduler = new JobScheduler(harness.runtime, { clock, idleMilliseconds: 1 })

  // When
  scheduler.start()
  await flush()

  // Then
  expect(harness.resolves()).toBe(0)
  expect(harness.persistence.repositories.jobs.get({ id: job.id })).toMatchObject({
    state: "failed",
    attemptCount: 1,
    lastErrorCode: "interrupted"
  })
  expect(harness.persistence.repositories.providerArtifacts.getProviderRun(runId)).toMatchObject({
    status: "failed"
  })
  await scheduler.stop()
})
