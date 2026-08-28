import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { z } from "zod"

import { createPersistence } from "../src/db"
import { ProviderRunIdSchema } from "../src/db/ids"
import { JobScheduler } from "../src/jobs/scheduler"
import { JobRuntime, createJobRegistry } from "../src/jobs/runtime"
import {
  ProviderIdSchema,
  ProviderKernel,
  ProviderRegistry,
  ToolIdSchema,
  ToolRegistry,
  collectProviderStream,
  createProviderInvokeJobDefinition,
  type ProviderRegistration
} from "../src/agents"
import { FakeModel } from "./fake-model"

const provider = (
  steps: ConstructorParameters<typeof FakeModel>[0]["steps"]
): ProviderRegistration => ({
  descriptor: {
    id: ProviderIdSchema.parse("fake"),
    mode: "test",
    model: { id: "fake-model", displayName: "Fake", maxOutputTokens: 128 },
    capabilities: { generation: true, structuredOutput: true, citedResearch: false }
  },
  enabled: true,
  createModel: () => new FakeModel({ modelId: "fake-model", steps }),
  health: async () => ({ kind: "healthy" })
})
const request = {
  providerId: "fake",
  messages: [{ role: "user" as const, content: [{ kind: "text" as const, text: "manual" }] }],
  output: { kind: "text" as const },
  toolIds: []
}
const directory = mkdtempSync(join(tmpdir(), "agent-kernel-manual-"))
const persistence = createPersistence({ dataDirectory: directory })
const echo = new ToolRegistry([
  {
    id: ToolIdSchema.parse("echo"),
    schema: z.object({ value: z.string() }),
    execute: ({ value }: { readonly value: string }) => ({ value })
  }
])
const text = await collectProviderStream(
  new ProviderKernel({
    providers: new ProviderRegistry([
      provider([{ kind: "text", chunks: ["manual"], usage: { inputTokens: 2, outputTokens: 1 } }])
    ]),
    tools: echo
  }).stream(request)
)
const structured = await collectProviderStream(
  new ProviderKernel({
    providers: new ProviderRegistry([
      provider([
        { kind: "structured", value: { answer: 4 } },
        { kind: "structured", value: { answer: "repaired" } }
      ])
    ]),
    tools: echo
  }).stream({
    ...request,
    output: { kind: "structured", schema: z.object({ answer: z.string() }) }
  })
)
const toolRun = await collectProviderStream(
  new ProviderKernel({
    providers: new ProviderRegistry([
      provider([
        { kind: "tool", name: "echo", input: { value: "ok" } },
        { kind: "text", chunks: ["tool-ok"] }
      ])
    ]),
    tools: echo
  }).stream({ ...request, toolIds: [ToolIdSchema.parse("echo")] })
)
const aborter = new AbortController()
const cancelledPromise = collectProviderStream(
  new ProviderKernel({
    providers: new ProviderRegistry([provider([{ kind: "hang" }])]),
    tools: echo
  }).stream({ ...request, signal: aborter.signal })
)
await Promise.resolve()
aborter.abort("manual")
const cancelled = await cancelledPromise
const failed = await collectProviderStream(
  new ProviderKernel({
    providers: new ProviderRegistry([provider([{ kind: "failure" }])]),
    tools: echo
  }).stream(request)
)
const jobKernel = new ProviderKernel({
  providers: new ProviderRegistry([
    provider([
      {
        kind: "text",
        chunks: ["job"],
        usage: { inputTokens: 3, outputTokens: 2, cacheTokens: 1 }
      }
    ])
  ]),
  tools: echo
})
const runId = crypto.randomUUID()
const requestHash = "b".repeat(64)
const definition = createProviderInvokeJobDefinition({
  kernel: jobKernel,
  providerRuns: persistence.repositories.providerArtifacts,
  jobs: persistence.repositories.jobs,
  requests: { resolve: () => request },
  authorization: { consume: () => true }
})
const runtime = new JobRuntime(persistence.repositories.jobs, createJobRegistry([definition]))
const job = runtime.enqueue({
  kind: "provider-invoke",
  input: { runId, providerId: "fake", mode: "test", model: "fake-model", requestHash },
  idempotencyKey: crypto.randomUUID()
})
const scheduler = new JobScheduler(runtime, {
  idleMilliseconds: 5,
  handlerTimeoutMilliseconds: 500
})
scheduler.start()
await new Promise<void>((resolve) => {
  const stop = runtime.subscribe(job.id, (event) => {
    if (event.kind === "succeeded" || event.kind === "failed" || event.kind === "cancelled") {
      stop()
      resolve()
    }
  })
})
await scheduler.stop()
const output = {
  text,
  structured,
  tool: toolRun,
  cancelled,
  failed,
  job: persistence.repositories.jobs.get({ id: job.id }),
  jobEvents: persistence.repositories.jobs
    .events({ id: job.id })
    .map((event) => ({ kind: event.kind, payload: event.payload })),
  providerRun: persistence.repositories.providerArtifacts.getProviderRun(
    ProviderRunIdSchema.parse(runId)
  )
}
persistence.close()
rmSync(directory, { recursive: true, force: true })
mkdirSync(".omo/evidence/task-6-interview-helper/job-manual", { recursive: true })
writeFileSync(
  ".omo/evidence/task-6-interview-helper/job-manual/kernel.json",
  `${JSON.stringify(output, null, 2)}\n`,
  { mode: 0o600 }
)
writeFileSync(
  ".omo/evidence/task-6-interview-helper/job-manual/contract-matrix.ndjson",
  `${JSON.stringify({ kind: "manual_kernel", outcome: "completed", cleanup: "temporary_data_removed" })}\n`,
  { mode: 0o600 }
)
