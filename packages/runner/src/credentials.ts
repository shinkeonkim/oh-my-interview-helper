import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { z } from "zod"

const StoredRunnerCredentialsSchema = z
  .object({
    runnerId: z.string().uuid(),
    token: z.string().min(32).max(512),
    runnerName: z.string().trim().min(1).max(128),
    endpoint: z.string().url(),
    capabilities: z.object({
      claudeSubscription: z.boolean(),
      claudeDirectAuth: z.boolean(),
      claudeBare: z.boolean(),
      codexSkipGitRepoCheck: z.boolean(),
      claudeVersion: z.string().nullable(),
      codexVersion: z.string().nullable()
    })
  })
  .strict()

export type StoredRunnerCredentials = z.output<typeof StoredRunnerCredentialsSchema>

export const defaultCredentialsPath = (
  environment: Readonly<Record<string, string | undefined>> = process.env
): string =>
  join(
    environment["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"),
    "interview-helper",
    "runner.json"
  )

export const saveRunnerCredentials = (path: string, value: StoredRunnerCredentials): void => {
  const parsed = StoredRunnerCredentialsSchema.parse(value)
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600, flag: "wx" })
  renameSync(temporary, path)
  chmodSync(path, 0o600)
}

export const loadRunnerCredentials = (path: string): StoredRunnerCredentials =>
  StoredRunnerCredentialsSchema.parse(JSON.parse(readFileSync(path, "utf8")))
