import { createApp } from "./app"
import {
  ensureDataDirectoryIsWritable,
  parseServerConfig,
  StartupConfigurationError
} from "./config"

const main = (): void => {
  try {
    const configuration = parseServerConfig(process.env)
    ensureDataDirectoryIsWritable(configuration)

    const server = Bun.serve({
      fetch: createApp().fetch,
      hostname: "127.0.0.1",
      port: configuration.port
    })

    console.info(`Server listening at ${server.url}`)
  } catch (error) {
    if (error instanceof StartupConfigurationError) {
      console.error(error.message)
      process.exitCode = 1
      return
    }

    throw error
  }
}

main()
