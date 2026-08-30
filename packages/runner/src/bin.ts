#!/usr/bin/env bun
import { runnerCli } from "./cli"

await runnerCli(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Runner failed")
  process.exitCode = 1
})
