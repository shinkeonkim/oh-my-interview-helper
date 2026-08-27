import { createApp } from "./app"
import {
  ensureDataDirectoryIsWritable,
  parseServerConfig,
  StartupConfigurationError
} from "./config"
import { createPersistence } from "./db"
import { JobScheduler } from "./jobs/scheduler"
import { createJobRegistry, JobRuntime } from "./jobs/runtime"
import {
  ProviderKernel,
  ToolRegistry,
  createProviderInvokeJobDefinition,
  unavailableProviderRequestSource
} from "./agents"
import { createDirectApiProviderRegistry } from "./providers"

const main = (): void => {
  try {
    const configuration = parseServerConfig(process.env)
    ensureDataDirectoryIsWritable(configuration)
    const persistence = createPersistence({ dataDirectory: configuration.dataDirectory })
    const providers = createDirectApiProviderRegistry(process.env)
    const jobs = new JobRuntime(
      persistence.repositories.jobs,
      createJobRegistry([
        createProviderInvokeJobDefinition({
          kernel: new ProviderKernel({
            providers,
            tools: new ToolRegistry([])
          }),
          providerRuns: persistence.repositories.providerArtifacts,
          jobs: persistence.repositories.jobs,
          requests: unavailableProviderRequestSource
        })
      ])
    )
    const scheduler = new JobScheduler(jobs)
    scheduler.start()

    const server = Bun.serve({
      fetch: createApp({
        dataDirectory: configuration.dataDirectory,
        security: configuration.security,
        persistence,
        jobRuntime: jobs,
        providerRegistry: providers
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
