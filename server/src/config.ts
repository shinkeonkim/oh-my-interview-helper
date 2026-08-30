import { accessSync, constants, mkdirSync } from "node:fs"
import { resolve } from "node:path"

import { z } from "zod"

import {
  LocalSecurityConfigurationError,
  parseLocalSecuritySettings,
  type LocalSecuritySettings
} from "./security/config"

export type RawEnvironment = Readonly<Record<string, string | undefined>>

const PortSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{0,4}$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(65535))
  .brand<"Port">()

const ServerEnvironmentSchema = z.object({
  PORT: PortSchema,
  DATA_DIR: z.string().trim().min(1),
  BIND_HOST: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1")
})

export type ServerConfig = {
  readonly port: z.output<typeof PortSchema>
  readonly bindHost: "127.0.0.1" | "0.0.0.0"
  readonly dataDirectory: string
  readonly security: LocalSecuritySettings
}

export type StartupConfigurationIssue = {
  readonly field: "PORT" | "DATA_DIR" | "BIND_HOST" | "SECURITY"
  readonly code: "missing" | "invalid" | "unavailable"
}

const formatIssue = (issue: StartupConfigurationIssue): string => `${issue.field}: ${issue.code}`

export class StartupConfigurationError extends Error {
  override readonly name = "StartupConfigurationError"

  constructor(readonly issues: readonly StartupConfigurationIssue[]) {
    super(`CONFIGURATION_ERROR: ${issues.map(formatIssue).join(", ")}`)
  }
}

type SchemaIssue = {
  readonly path: readonly PropertyKey[]
}

const toStartupConfigurationIssue = (
  issue: SchemaIssue,
  environment: RawEnvironment
): StartupConfigurationIssue => {
  const field =
    issue.path[0] === "PORT" ? "PORT" : issue.path[0] === "BIND_HOST" ? "BIND_HOST" : "DATA_DIR"

  return {
    field,
    code: environment[field] === undefined ? "missing" : "invalid"
  }
}

export const parseServerConfig = (environment: RawEnvironment): ServerConfig => {
  const parsed = ServerEnvironmentSchema.safeParse(environment)

  if (!parsed.success) {
    throw new StartupConfigurationError(
      parsed.error.issues.map((issue) => toStartupConfigurationIssue(issue, environment))
    )
  }

  const security = (() => {
    try {
      return parseLocalSecuritySettings(environment, parsed.data.PORT)
    } catch (error) {
      if (error instanceof LocalSecurityConfigurationError)
        throw new StartupConfigurationError([{ field: "SECURITY", code: "invalid" }])
      throw error
    }
  })()

  return {
    port: parsed.data.PORT,
    bindHost: parsed.data.BIND_HOST,
    dataDirectory: resolve(parsed.data.DATA_DIR),
    security
  }
}

export const ensureDataDirectoryIsWritable = ({ dataDirectory }: ServerConfig): void => {
  try {
    mkdirSync(dataDirectory, { recursive: true })
    accessSync(dataDirectory, constants.W_OK)
  } catch (error) {
    if (error instanceof Error) {
      throw new StartupConfigurationError([{ field: "DATA_DIR", code: "unavailable" }])
    }

    throw error
  }
}
