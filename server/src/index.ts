import { createApp } from "./app"
import {
  ensureDataDirectoryIsWritable,
  parseServerConfig,
  StartupConfigurationError
} from "./config"
import { createPersistence } from "./db"
import { JobScheduler } from "./jobs/scheduler"
import { createJobRegistry, JobRuntime } from "./jobs/runtime"

const main = (): void => {
  try {
    const configuration = parseServerConfig(process.env)
    ensureDataDirectoryIsWritable(configuration)
    const persistence = createPersistence({ dataDirectory: configuration.dataDirectory })
    const jobs = new JobRuntime(persistence.repositories.jobs, createJobRegistry([]))
    const scheduler = new JobScheduler(jobs)
    scheduler.start()

    const server = Bun.serve({
      fetch: createApp({
        dataDirectory: configuration.dataDirectory,
        security: configuration.security,
        persistence,
        jobRuntime: jobs
      }).fetch,
      hostname: "127.0.0.1",
      port: configuration.port,
      maxRequestBodySize: configuration.security.requestBytes
    })

    console.info(`Server listening at ${server.url}`)
    const shutdown = (): void => {
      server.stop(true)
      void scheduler.stop().then(() => {
        persistence.close()
        process.exit(0)
      })
    }
    process.once("SIGINT", shutdown)
    process.once("SIGTERM", shutdown)
  } catch (error) {
    if (error instanceof StartupConfigurationError) {
      console.error(error.message)
      process.exitCode = 1
      return
    }

    console.error("STARTUP_ERROR")
    process.exitCode = 1
  }
}

main()
