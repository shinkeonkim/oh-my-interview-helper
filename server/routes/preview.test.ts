import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createApp } from "../src/app"
import type { PinnedTransport, Resolver } from "../src/ingest/safe-fetcher"

const directories: string[] = []

const dataDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-preview-route-"))
  directories.push(directory)
  return directory
}

const csrf = async (
  app: ReturnType<typeof createApp>
): Promise<{ readonly cookie: string; readonly token: string }> => {
  const response = await app.request("http://localhost:3000/api/security/csrf")
  const body: unknown = JSON.parse(await response.text())
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0]
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

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe("local preview routes", () => {
  test("returns bounded extracted local text without invoking the URL transport", async () => {
    // Given
    let requests = 0
    const transport: PinnedTransport = {
      request: async () => {
        requests += 1
        throw new Error("must not run")
      }
    }
    const app = createApp({ dataDirectory: dataDirectory(), transport })
    const token = await csrf(app)
    const form = new FormData()
    form.append(
      "file",
      new File(["# Local resume\nInert data"], "resume.md", { type: "text/markdown" })
    )

    // When
    const response = await app.request("http://localhost:3000/api/preview/file", {
      body: form,
      headers: { Cookie: token.cookie, "X-CSRF-Token": token.token },
      method: "POST"
    })

    // Then
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      format: "markdown",
      text: "# Local resume\nInert data"
    })
    expect(requests).toBe(0)
  })

  test("returns a controlled public URL preview through the injected pinned resolver and transport", async () => {
    // Given
    const resolver: Resolver = { resolve: async () => ["93.184.216.34"] }
    const transport: PinnedTransport = {
      request: async () => ({
        body: (async function* (): AsyncGenerator<Uint8Array> {
          yield new TextEncoder().encode("<p>Public role</p>")
        })(),
        headers: new Headers({ "content-type": "text/html" }),
        status: 200
      })
    }
    const app = createApp({ dataDirectory: dataDirectory(), resolver, transport })
    const token = await csrf(app)

    // When
    const response = await app.request("http://localhost:3000/api/preview/url", {
      body: JSON.stringify({ url: "https://public.test/job?token=CANARY" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: token.cookie,
        "X-CSRF-Token": token.token
      },
      method: "POST"
    })

    // Then
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      contentType: "text/html",
      text: "Public role",
      url: "https://public.test/job"
    })
  })
})
