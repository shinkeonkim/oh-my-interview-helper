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
import { ProviderRegistry } from "./agents"
import { createCliProvider, createDirectApiProviderRegistry } from "./providers"
import { RunnerPairingService } from "./runner/pairing"
import { RunnerWebSocketHub, type HubSocket, type HubSocketData } from "./runner/websocket-hub"

const main = (): void => {
  try {
    const configuration = parseServerConfig(process.env)
    ensureDataDirectoryIsWritable(configuration)
    const persistence = createPersistence({ dataDirectory: configuration.dataDirectory })
    const pairing = new RunnerPairingService(persistence.database)
    const runnerHub = new RunnerWebSocketHub(pairing)
    const directProviders = createDirectApiProviderRegistry(process.env)
    const providers = new ProviderRegistry([
      ...directProviders.list(),
      createCliProvider({ id: "claude-cli", model: "sonnet", transport: runnerHub }),
      createCliProvider({ id: "codex-cli", model: "gpt-5.4", transport: runnerHub })
    ])
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

    const app = createApp({
      dataDirectory: configuration.dataDirectory,
      security: configuration.security,
      persistence,
      jobRuntime: jobs,
      providerRegistry: providers,
      runnerPairing: pairing,
      revokeRunnerConnection: (runnerId) => runnerHub.revoke(runnerId)
    })
    const server = Bun.serve<HubSocketData>({
      fetch: (request, bunServer) => {
        const url = new URL(request.url)
        if (url.pathname !== "/api/runner/ws") return app.fetch(request)
        const host = request.headers.get("host")?.toLowerCase()
        const origin = request.headers.get("origin")
        if (
          host === undefined ||
          !configuration.security.allowedHosts.includes(host) ||
          (origin !== null && new URL(origin).host.toLowerCase() !== host)
        )
          return new Response("Forbidden", { status: 403 })
        return bunServer.upgrade(request, {
          data: { runnerId: null, capabilities: new Set() }
        })
          ? undefined
          : new Response("Upgrade required", { status: 426 })
      },
      websocket: {
        open: (socket) => runnerHub.open(socket as unknown as HubSocket),
        message: (socket, message) => {
          if (typeof message !== "string") return socket.close(1003, "text_only")
          void runnerHub
            .message(socket as unknown as HubSocket, message)
            .catch(() => socket.close(1008, "invalid_protocol"))
        },
        close: (socket) => runnerHub.close(socket as unknown as HubSocket)
      },
      hostname: configuration.bindHost,
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
