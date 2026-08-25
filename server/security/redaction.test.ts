import { describe, expect, test } from "bun:test"

import { redactSensitiveText, safeErrorCode } from "../src/security/redaction"

describe("sensitive error and log redaction", () => {
  test("removes credentials, query secrets, cookies, canaries, local paths, and raw document text", () => {
    // Given
    const secret = "CANARY_SECRET_123"
    const source = `Bearer ${secret}; Cookie: session=${secret}; https://example.test/?token=${secret}; /Users/test/${secret}; resume text ${secret}`

    // When
    const redacted = redactSensitiveText(source)

    // Then
    expect(redacted).not.toContain(secret)
    expect(redacted).not.toContain("/Users/test")
    expect(redacted).toContain("[REDACTED]")
  })

  test("returns only a typed public error code for parser and transport failures", () => {
    // Given
    const error = new Error("parser stderr includes CANARY_SECRET_123")

    // When
    const response = safeErrorCode(error, "EXTRACTION_FAILED")

    // Then
    expect(response).toEqual({ error: { code: "EXTRACTION_FAILED" } })
  })
})
