import { lookup } from "node:dns/promises"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { isIP } from "node:net"

import type { LocalSecuritySettings } from "../security/config"
import { unsafeAddress } from "./address-policy"
import { htmlToPlainText } from "./html-text"

export const FetchBoundaryErrorCode = {
  ContentTypeNotAllowed: "CONTENT_TYPE_NOT_ALLOWED",
  FetchFailed: "FETCH_FAILED",
  FetchTimeout: "FETCH_TIMEOUT",
  FetchTooLarge: "FETCH_TOO_LARGE",
  RedirectLimit: "REDIRECT_LIMIT",
  UnsafeAddress: "UNSAFE_ADDRESS",
  UrlCredentialsNotAllowed: "URL_CREDENTIALS_NOT_ALLOWED",
  UrlNotAllowed: "URL_NOT_ALLOWED"
} as const

export type FetchBoundaryErrorCode =
  (typeof FetchBoundaryErrorCode)[keyof typeof FetchBoundaryErrorCode]

export class FetchBoundaryError extends Error {
  override readonly name = "FetchBoundaryError"

  constructor(readonly code: FetchBoundaryErrorCode) {
    super(code)
  }
}

export type Resolver = {
  readonly resolve: (hostname: string) => Promise<readonly string[]>
}

export type PinnedRequest = {
  readonly address: string
  readonly headers: Readonly<Record<string, string>>
  readonly hostname: string
  readonly signal: AbortSignal
  readonly url: URL
}

export type PinnedResponse = {
  readonly body: AsyncIterable<Uint8Array>
  readonly headers: Headers
  readonly status: number
}

export type PinnedTransport = {
  readonly request: (request: PinnedRequest) => Promise<PinnedResponse>
}

export type PublicText = {
  readonly contentType: string
  readonly text: string
  readonly url: string
}

const TextContentTypes = new Set(["application/xhtml+xml", "text/html", "text/plain", "text/xml"])
const RedirectStatuses = new Set([301, 302, 303, 307, 308])

const hostnameFor = (url: URL): string => url.hostname.replace(/^\[|\]$/g, "")

const publicUrl = (url: URL): string => `${url.protocol}//${url.host}${url.pathname}`

const normalizeUrl = (source: string): URL => {
  let url: URL
  try {
    url = new URL(source)
  } catch {
    throw new FetchBoundaryError(FetchBoundaryErrorCode.UrlNotAllowed)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new FetchBoundaryError(FetchBoundaryErrorCode.UrlNotAllowed)
  if (url.username !== "" || url.password !== "")
    throw new FetchBoundaryError(FetchBoundaryErrorCode.UrlCredentialsNotAllowed)
  url.hash = ""
  return url
}

const defaultResolver: Resolver = {
  resolve: async (hostname) => {
    if (isIP(hostname) !== 0) return [hostname]
    const records = await lookup(hostname, { all: true, order: "verbatim" })
    return records.map((record) => record.address)
  }
}

const nodeTransport: PinnedTransport = {
  request: async ({ address, headers, hostname, signal, url }) =>
    await new Promise<PinnedResponse>((resolve, reject) => {
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        {
          agent: false,
          family: isIP(address),
          headers,
          hostname: address,
          method: "GET",
          path: `${url.pathname}${url.search}`,
          port: url.port === "" ? undefined : Number(url.port),
          servername: url.protocol === "https:" ? hostname : undefined,
          signal
        },
        (response) => {
          const responseHeaders = new Headers()
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined)
              responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : value)
          }
          resolve({ body: response, headers: responseHeaders, status: response.statusCode ?? 502 })
        }
      )
      request.once("error", reject)
      request.end()
    })
}

const addressFor = async (url: URL, resolver: Resolver): Promise<string> => {
  let addresses: readonly string[]
  try {
    addresses = await resolver.resolve(hostnameFor(url))
  } catch {
    throw new FetchBoundaryError(FetchBoundaryErrorCode.FetchFailed)
  }
  if (addresses.length === 0 || addresses.some(unsafeAddress))
    throw new FetchBoundaryError(FetchBoundaryErrorCode.UnsafeAddress)
  return (
    addresses[0] ??
    (() => {
      throw new FetchBoundaryError(FetchBoundaryErrorCode.UnsafeAddress)
    })()
  )
}

const bodyText = async (response: PinnedResponse, maximumBytes: number): Promise<string> => {
  const declaredLength = response.headers.get("content-length")
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumBytes)
  )
    throw new FetchBoundaryError(FetchBoundaryErrorCode.FetchTooLarge)
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of response.body) {
    total += chunk.byteLength
    if (total > maximumBytes) throw new FetchBoundaryError(FetchBoundaryErrorCode.FetchTooLarge)
    chunks.push(chunk)
  }
  const data = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data)
  } catch {
    throw new FetchBoundaryError(FetchBoundaryErrorCode.FetchFailed)
  }
}

export const fetchPublicText = async ({
  limits,
  resolver = defaultResolver,
  transport = nodeTransport,
  url: source
}: {
  readonly limits: LocalSecuritySettings
  readonly resolver?: Resolver | undefined
  readonly transport?: PinnedTransport | undefined
  readonly url: string
}): Promise<PublicText> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), limits.fetchTimeoutMilliseconds)
  try {
    let url = normalizeUrl(source)
    for (let redirects = 0; ; redirects += 1) {
      const address = await addressFor(url, resolver)
      let response: PinnedResponse
      try {
        response = await transport.request({
          address,
          headers: {
            accept: "text/html, text/plain, application/xhtml+xml, text/xml",
            host: url.host
          },
          hostname: hostnameFor(url),
          signal: controller.signal,
          url
        })
      } catch {
        throw new FetchBoundaryError(
          controller.signal.aborted
            ? FetchBoundaryErrorCode.FetchTimeout
            : FetchBoundaryErrorCode.FetchFailed
        )
      }
      if (RedirectStatuses.has(response.status)) {
        if (redirects >= limits.fetchRedirects)
          throw new FetchBoundaryError(FetchBoundaryErrorCode.RedirectLimit)
        const location = response.headers.get("location")
        if (location === null) throw new FetchBoundaryError(FetchBoundaryErrorCode.FetchFailed)
        url = normalizeUrl(new URL(location, url).toString())
        continue
      }
      if (response.status < 200 || response.status >= 300)
        throw new FetchBoundaryError(FetchBoundaryErrorCode.FetchFailed)
      const contentType =
        response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() ?? ""
      if (!TextContentTypes.has(contentType))
        throw new FetchBoundaryError(FetchBoundaryErrorCode.ContentTypeNotAllowed)
      const sourceText = await bodyText(response, limits.fetchBytes)
      const text =
        contentType === "text/html" || contentType === "application/xhtml+xml"
          ? htmlToPlainText(sourceText, limits.fetchBytes)
          : sourceText.trim()
      if (text.length === 0) throw new FetchBoundaryError(FetchBoundaryErrorCode.FetchFailed)
      return { contentType, text, url: publicUrl(url) }
    }
  } catch (error) {
    if (error instanceof FetchBoundaryError) throw error
    throw new FetchBoundaryError(
      controller.signal.aborted
        ? FetchBoundaryErrorCode.FetchTimeout
        : FetchBoundaryErrorCode.FetchFailed
    )
  } finally {
    clearTimeout(timeout)
  }
}
