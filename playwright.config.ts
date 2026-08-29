import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./client/tests",
  testMatch: "**/*.pw.ts",
  retries: process.env.CI ? 1 : 0,
  timeout: 10_000,
  use: {
    baseURL: "http://127.0.0.1:5187",
    trace: "on-first-retry"
  },
  webServer: {
    command: "bun run --cwd client dev -- --mode test --port 5187",
    url: "http://127.0.0.1:5187",
    reuseExistingServer: true,
    timeout: 15_000
  }
})
