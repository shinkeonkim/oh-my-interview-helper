import { describe, expect, test } from "bun:test"

import { defaultLocalSecuritySettings } from "../src/security/config"
import {
  fetchPublicText,
  type FetchBoundaryError,
  type PinnedTransport,
  type Resolver
} from "../src/ingest/safe-fetcher"

const limits = (overrides: Partial<ReturnType<typeof defaultLocalSecuritySettings>>) => ({
  ...defaultLocalSecuritySettings(),
  ...overrides
})

const bytes = (value: string): AsyncIterable<Uint8Array> =>
  (async function* (): AsyncGenerator<Uint8Array> {
    yield new TextEncoder().encode(value)
  })()

const response = (status: number, contentType: string, body: string, location?: string) => ({
  body: bytes(body),
  headers: new Headers({
    "content-type": contentType,
    ...(location === undefined ? {} : { location })
  }),
  status
})

const resolver = (records: Readonly<Record<string, readonly string[]>>): Resolver => ({
  resolve: async (hostname) => records[hostname] ?? []
})

describe("pinned public URL fetcher", () => {
  test("blocks direct loopback, private, link-local, multicast, metadata, reserved, and IPv6 addresses", async () => {
    // Given
    const disallowed = [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "224.0.0.1",
      "192.0.2.1",
      "0.0.0.0",
      "[::1]",
      "[fc00::1]",
      "[fe80::1]",
      "[ff02::1]"
    ]
    const transport: PinnedTransport = { request: async () => response(200, "text/plain", "never") }

    // When / Then
    for (const host of disallowed)
      await expect(
        fetchPublicText({
          limits: limits({}),
          resolver: resolver({}),
          transport,
          url: `http://${host}/`
        })
      ).rejects.toMatchObject({ code: "UNSAFE_ADDRESS" } satisfies Partial<FetchBoundaryError>)
  })

  test("rejects IPv4-mapped loopback while permitting mapped public resolver results", async () => {
    // Given
    const transport: PinnedTransport = { request: async () => response(200, "text/plain", "safe") }

    // When / Then
    await expect(
      fetchPublicText({
        limits: limits({}),
        resolver: resolver({ "mapped-loopback.test": ["::ffff:7f00:1"] }),
        transport,
        url: "http://mapped-loopback.test/"
      })
    ).rejects.toMatchObject({ code: "UNSAFE_ADDRESS" } satisfies Partial<FetchBoundaryError>)
    await expect(
      fetchPublicText({
        limits: limits({}),
        resolver: resolver({ "mapped-public.test": ["::ffff:5db8:d822"] }),
        transport,
        url: "http://mapped-public.test/"
      })
    ).resolves.toMatchObject({ text: "safe" })
  })

  test("pins a validated DNS result, strips credentials, and sanitizes bounded HTML text", async () => {
    // Given
    const requests: Parameters<PinnedTransport["request"]>[0][] = []
    const transport: PinnedTransport = {
      request: async (request) => {
        requests.push(request)
        return response(
          200,
          "text/html",
          "<h1>Resume</h1><script>steal()</script><p>Safe &amp; inert</p>"
        )
      }
    }

    // When
    const result = await fetchPublicText({
      limits: limits({}),
      resolver: resolver({ "public.test": ["93.184.216.34"] }),
      transport,
      url: "https://public.test/path?token=CANARY_SECRET"
    })

    // Then
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ address: "93.184.216.34", hostname: "public.test" })
    expect(requests[0]?.headers).not.toHaveProperty("authorization")
    expect(requests[0]?.headers).not.toHaveProperty("cookie")
    expect(result).toEqual({
      contentType: "text/html",
      text: "Resume Safe & inert",
      url: "https://public.test/path"
    })
  })

  test("re-resolves and blocks private redirect and DNS-rebind destinations before a second connection", async () => {
    // Given
    let calls = 0
    const transport: PinnedTransport = {
      request: async () => {
        calls += 1
        return response(302, "text/plain", "", "http://rebind.test/private")
      }
    }

    // When / Then
    await expect(
      fetchPublicText({
        limits: limits({}),
        resolver: resolver({ "public.test": ["93.184.216.34"], "rebind.test": ["127.0.0.1"] }),
        transport,
        url: "http://public.test/"
      })
    ).rejects.toMatchObject({ code: "UNSAFE_ADDRESS" } satisfies Partial<FetchBoundaryError>)
    expect(calls).toBe(1)
  })

  test("rejects URL credentials, unsupported content, redirect exhaustion, oversized streams, and timeout aborts", async () => {
    // Given
    const publicResolver = resolver({ "public.test": ["93.184.216.34"] })
    const plainTransport: PinnedTransport = {
      request: async () => response(200, "application/pdf", "binary")
    }
    const redirectTransport: PinnedTransport = {
      request: async () => response(302, "text/plain", "", "/next")
    }
    const oversizedTransport: PinnedTransport = {
      request: async () => response(200, "text/plain", "too long")
    }
    const hungTransport: PinnedTransport = {
      request: async (request) =>
        await new Promise<never>((_, reject) =>
          request.signal.addEventListener("abort", () => reject(new Error("aborted")))
        )
    }

    // When / Then
    await expect(
      fetchPublicText({
        limits: limits({}),
        resolver: publicResolver,
        transport: plainTransport,
        url: "http://user:pass@public.test/"
      })
    ).rejects.toMatchObject({
      code: "URL_CREDENTIALS_NOT_ALLOWED"
    } satisfies Partial<FetchBoundaryError>)
    await expect(
      fetchPublicText({
        limits: limits({}),
        resolver: publicResolver,
        transport: plainTransport,
        url: "http://public.test/"
      })
    ).rejects.toMatchObject({
      code: "CONTENT_TYPE_NOT_ALLOWED"
    } satisfies Partial<FetchBoundaryError>)
    await expect(
      fetchPublicText({
        limits: limits({ fetchRedirects: 1 }),
        resolver: publicResolver,
        transport: redirectTransport,
        url: "http://public.test/"
      })
    ).rejects.toMatchObject({ code: "REDIRECT_LIMIT" } satisfies Partial<FetchBoundaryError>)
    await expect(
      fetchPublicText({
        limits: limits({ fetchBytes: 3 }),
        resolver: publicResolver,
        transport: oversizedTransport,
        url: "http://public.test/"
      })
    ).rejects.toMatchObject({ code: "FETCH_TOO_LARGE" } satisfies Partial<FetchBoundaryError>)
    await expect(
      fetchPublicText({
        limits: limits({ fetchTimeoutMilliseconds: 1 }),
        resolver: publicResolver,
        transport: hungTransport,
        url: "http://public.test/"
      })
    ).rejects.toMatchObject({ code: "FETCH_TIMEOUT" } satisfies Partial<FetchBoundaryError>)
  })
})
