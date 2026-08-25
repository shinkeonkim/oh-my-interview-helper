import { describe, expect, test } from "bun:test"

import { createApp } from "../src/app"

const localUrl = (path: string): string => `http://localhost:3000${path}`

const bootstrapCsrf = async (
  app = createApp()
): Promise<{ readonly cookie: string; readonly token: string }> => {
  const response = await app.request(localUrl("/api/security/csrf"))
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0]
  const body: unknown = JSON.parse(await response.text())
  if (
    cookie === undefined ||
    typeof body !== "object" ||
    body === null ||
    !("csrfToken" in body) ||
    typeof body.csrfToken !== "string"
  )
    throw new Error("CSRF bootstrap contract violated")
  return { cookie, token: body.csrfToken }
}

describe("local HTTP security boundary", () => {
  test("rejects an unconfigured Host before serving the health route", async () => {
    // Given
    const app = createApp()

    // When
    const response = await app.request("http://attacker.invalid/api/health")

    // Then
    expect(response.status).toBe(421)
    expect(await response.json()).toEqual({ error: { code: "HOST_NOT_ALLOWED" } })
  })

  test("rejects a cross-site Origin without reflecting a CORS policy", async () => {
    // Given
    const app = createApp()

    // When
    const response = await app.request(localUrl("/api/health"), {
      headers: { Origin: "https://attacker.invalid" }
    })

    // Then
    expect(response.status).toBe(403)
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
    expect(await response.json()).toEqual({ error: { code: "ORIGIN_NOT_ALLOWED" } })
  })

  test("returns a SameSite CSRF cookie and matching header token through the bootstrap route", async () => {
    // Given
    const app = createApp()

    // When
    const response = await app.request(localUrl("/api/security/csrf"))

    // Then
    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toContain("SameSite=Strict")
    expect(await response.json()).toEqual({ csrfToken: expect.any(String) })
  })

  test("requires a matching CSRF cookie and header for every preview mutation", async () => {
    // Given
    const app = createApp()
    const form = new FormData()
    form.append("file", new File(["resume text"], "resume.txt", { type: "text/plain" }))

    // When
    const response = await app.request(localUrl("/api/preview/file"), {
      method: "POST",
      body: form
    })

    // Then
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: { code: "CSRF_INVALID" } })
  })

  test("rejects arbitrary matching CSRF pairs and accepts only a server-issued replay", async () => {
    // Given
    const app = createApp({ csrfSecret: new Uint8Array(32).fill(7) })
    const csrf = await bootstrapCsrf(app)
    const request = (cookie: string, token: string) =>
      app.request(localUrl("/api/preview/url"), {
        body: JSON.stringify({ url: "https://public.test/" }),
        headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": token },
        method: "POST"
      })

    // When
    const arbitrary = await request("interview_helper_csrf=attacker", "attacker")
    const valid = await request(csrf.cookie, csrf.token)

    // Then
    expect(arbitrary.status).toBe(403)
    expect(valid.status).not.toBe(403)
  })

  test("rejects forwarded-host assumptions, cross-site fetch metadata, and a mismatched CSRF token", async () => {
    // Given
    const app = createApp()
    const csrf = await bootstrapCsrf(app)

    // When
    const forwarded = await app.request(localUrl("/api/health"), {
      headers: { "X-Forwarded-Host": "attacker.invalid" }
    })
    const crossSite = await app.request(localUrl("/api/health"), {
      headers: { "Sec-Fetch-Site": "cross-site" }
    })
    const mismatchedToken = await app.request(localUrl("/api/preview/url"), {
      body: JSON.stringify({ url: "https://public.test/" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: csrf.cookie,
        "X-CSRF-Token": "not-the-issued-token"
      },
      method: "POST"
    })

    // Then
    expect(forwarded.status).toBe(421)
    expect(crossSite.status).toBe(403)
    expect(mismatchedToken.status).toBe(403)
  })

  test("enforces a bounded request body and emits safe browser-facing security headers", async () => {
    // Given
    const app = createApp()
    const csrf = await bootstrapCsrf(app)
    const form = new FormData()
    form.append("file", new File(["x".repeat(10 * 1024 * 1024)], "resume.txt"))

    // When
    const response = await app.request(localUrl("/api/preview/file"), {
      method: "POST",
      body: form,
      headers: { Cookie: csrf.cookie, "X-CSRF-Token": csrf.token }
    })

    // Then
    expect(response.status).toBe(413)
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(await response.json()).toEqual({ error: { code: "REQUEST_TOO_LARGE" } })
  })
})
