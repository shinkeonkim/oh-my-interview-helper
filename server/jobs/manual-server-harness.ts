import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { z } from "zod"

import { createApp } from "../src/app"
import { createPersistence } from "../src/db"
import { createJobRegistry, JobRuntime, type JobDefinition } from "../src/jobs/runtime"
import { JobScheduler } from "../src/jobs/scheduler"
import { parseLocalSecuritySettings } from "../src/security/config"

const EnvironmentSchema = z.object({
  DATA_DIR: z.string().trim().min(1),
  PORT: z.coerce.number().int().min(1).max(65_535),
  RETRY_BLOCKING_ATTEMPTS: z.coerce.number().int().nonnegative().default(1)
})

type HarnessConfig = z.output<typeof EnvironmentSchema>
type HandlerPhase = "aborted" | "started" | "succeeded"
type HandlerRecord = {
  readonly attempt: number
  readonly jobId: string
  readonly kind: string
  readonly phase: HandlerPhase
}

const never = (): Promise<void> => new Promise(() => undefined)

const attemptPath = (config: HarnessConfig, kind: string, jobId: string): string =>
  join(config.DATA_DIR, `manual-${kind}-${jobId}.attempt`)

const barrierPath = (config: HarnessConfig, kind: string, jobId: string): string =>
  join(config.DATA_DIR, `manual-${kind}-${jobId}.barrier`)

const record = (config: HarnessConfig, event: HandlerRecord): void => {
  appendFileSync(join(config.DATA_DIR, "manual-handler.ndjson"), `${JSON.stringify(event)}\n`, {
    mode: 0o600
  })
}

const begin = (config: HarnessConfig, kind: string, jobId: string): number => {
  const path = attemptPath(config, kind, jobId)
  const previous = existsSync(path) ? Number.parseInt(readFileSync(path, "utf8"), 10) : 0
  const attempt = (Number.isInteger(previous) ? previous : 0) + 1
  writeFileSync(path, `${attempt}\n`, { mode: 0o600 })
  writeFileSync(barrierPath(config, kind, jobId), "running\n", { mode: 0o600 })
  record(config, { attempt, jobId, kind, phase: "started" })
  console.info(`HANDLER_STARTED ${kind} ${jobId}`)
  return attempt
}

const finish = (config: HarnessConfig, event: Omit<HandlerRecord, "phase">): void => {
  rmSync(barrierPath(config, event.kind, event.jobId), { force: true })
  record(config, { ...event, phase: "succeeded" })
}

const definitions = (config: HarnessConfig): readonly JobDefinition[] => [
  {
    kind: "manual.success",
    retryClass: "local",
    maxAttempts: 1,
    run: async ({ job }) => {
      const attempt = begin(config, "success", job.id)
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
      finish(config, { attempt, jobId: job.id, kind: "success" })
    }
  },
  {
    kind: "manual.blocking",
    retryClass: "local",
    maxAttempts: 1,
    run: ({ job, signal }) =>
      new Promise<void>((resolve) => {
        const attempt = begin(config, "blocking", job.id)
        signal.addEventListener(
          "abort",
          () => {
            rmSync(barrierPath(config, "blocking", job.id), { force: true })
            record(config, { attempt, jobId: job.id, kind: "blocking", phase: "aborted" })
            resolve()
          },
          { once: true }
        )
      })
  },
  {
    kind: "manual.retry-local",
    retryClass: "local",
    maxAttempts: 2,
    run: async ({ job }) => {
      const attempt = begin(config, "retry-local", job.id)
      if (attempt <= config.RETRY_BLOCKING_ATTEMPTS) return never()
      finish(config, { attempt, jobId: job.id, kind: "retry-local" })
    }
  },
  {
    kind: "manual.external",
    retryClass: "external",
    maxAttempts: 1,
    run: ({ job }) => {
      begin(config, "external", job.id)
      return never()
    }
  }
]

const main = (): void => {
  const config = EnvironmentSchema.parse(process.env)
  const persistence = createPersistence({ dataDirectory: config.DATA_DIR })
  const runtime = new JobRuntime(
    persistence.repositories.jobs,
    createJobRegistry(definitions(config))
  )
  const scheduler = new JobScheduler(runtime, {
    concurrency: 1,
    heartbeatMilliseconds: 50,
    idleMilliseconds: 10,
    leaseMilliseconds: 300,
    shutdownGraceMilliseconds: 100
  })
  scheduler.start()
  const server = Bun.serve({
    fetch: createApp({
      persistence,
      jobRuntime: runtime,
      security: parseLocalSecuritySettings({}, config.PORT)
    }).fetch,
    hostname: "127.0.0.1",
    port: config.PORT
  })
  console.info(`HARNESS_READY ${server.url}`)

  let closing = false
  const shutdown = (): void => {
    if (closing) return
    closing = true
    server.stop(true)
    void scheduler.stop().then(() => {
      persistence.close()
      process.exit(0)
    })
  }
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
  console.info("HARNESS_SIGNAL_READY")
}

main()
