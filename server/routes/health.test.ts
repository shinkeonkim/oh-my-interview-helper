import { describe, expect, test } from "bun:test"

import { createApp } from "../src/app"
import {
  ensureDataDirectoryIsWritable,
  parseServerConfig,
  StartupConfigurationError,
  type StartupConfigurationIssue
} from "../src/config"

class TestContractError extends Error {
  override readonly name = "TestContractError"
}

const captureStartupConfigurationError = (action: () => void): StartupConfigurationError => {
  try {
    action()
  } catch (error) {
    if (error instanceof StartupConfigurationError) {
      return error
    }

    throw error
  }

  throw new TestContractError("Expected a StartupConfigurationError")
}

describe("server startup contracts", () => {
  test("returns the health status when the API health route is requested", async () => {
    // Given
    const app = createApp()

    // When
    const response = await app.request("http://localhost:3000/api/health")

    // Then
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ok" })
  })

  test("returns a sanitized typed error when the port is invalid", () => {
    // Given
    const portCanary = "PORT_CANARY_must_not_leak"

    // When
    const error = captureStartupConfigurationError(() =>
      parseServerConfig({ PORT: portCanary, DATA_DIR: "/tmp/interview-helper" })
    )

    // Then
    const expectedIssues: readonly StartupConfigurationIssue[] = [
      { field: "PORT", code: "invalid" }
    ]
    expect(error.issues).toEqual(expectedIssues)
    expect(error.message).toBe("CONFIGURATION_ERROR: PORT: invalid")
    expect(error.message).not.toContain(portCanary)
  })

  test("returns a sanitized typed error when the data directory is missing", () => {
    // Given
    const dataCanary = "DATA_CANARY_must_not_leak"

    // When
    const error = captureStartupConfigurationError(() => parseServerConfig({ PORT: "3000" }))

    // Then
    const expectedIssues: readonly StartupConfigurationIssue[] = [
      { field: "DATA_DIR", code: "missing" }
    ]
    expect(error.issues).toEqual(expectedIssues)
    expect(error.message).toBe("CONFIGURATION_ERROR: DATA_DIR: missing")
    expect(error.message).not.toContain(dataCanary)
  })

  test("returns a sanitized typed error when the data directory is unavailable", () => {
    // Given
    const dataCanary = "/dev/null/DATA_CANARY_must_not_leak"
    const configuration = parseServerConfig({ PORT: "3000", DATA_DIR: dataCanary })

    // When
    const error = captureStartupConfigurationError(() =>
      ensureDataDirectoryIsWritable(configuration)
    )

    // Then
    const expectedIssues: readonly StartupConfigurationIssue[] = [
      { field: "DATA_DIR", code: "unavailable" }
    ]
    expect(error.issues).toEqual(expectedIssues)
    expect(error.message).toBe("CONFIGURATION_ERROR: DATA_DIR: unavailable")
    expect(error.message).not.toContain(dataCanary)
  })
})
