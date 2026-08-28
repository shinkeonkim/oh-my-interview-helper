import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

import type { Context, MiddlewareHandler } from "hono"

import type { LocalSecuritySettings } from "./config"

const CsrfCookieName = "interview_helper_csrf"
const MutationMethods = new Set(["DELETE", "PATCH", "POST", "PUT"])

const setSecurityHeaders = (context: Context): void => {
  context.header(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self'"
  )
  context.header("Cross-Origin-Opener-Policy", "same-origin")
  context.header("Cross-Origin-Resource-Policy", "same-origin")
  context.header("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=()")
  context.header("Referrer-Policy", "no-referrer")
  context.header("X-Content-Type-Options", "nosniff")
  context.header("X-Frame-Options", "DENY")
}

const errorResponse = (context: Context, code: string, status: 400 | 403 | 421): Response =>
  context.json({ error: { code } }, status)

const requestHost = (context: Context): string | null => {
  const url = new URL(context.req.url)
  const forwardedHeaders = ["forwarded", "x-forwarded-host", "x-forwarded-proto"]
  if (forwardedHeaders.some((header) => context.req.header(header) !== undefined)) return null
  const hostHeader = context.req.header("host")
  if (hostHeader !== undefined && hostHeader.toLowerCase() !== url.host.toLowerCase()) return null
  return url.host.toLowerCase()
}

const requestOriginIsAllowed = (context: Context, host: string): boolean => {
  const origin = context.req.header("origin")
  if (origin !== undefined) return origin === `http://${host}`
  const fetchSite = context.req.header("sec-fetch-site")
  return fetchSite === undefined || fetchSite === "none" || fetchSite === "same-origin"
}

const readCookie = (cookieHeader: string | undefined, name: string): string | undefined => {
  if (cookieHeader === undefined) return undefined
  for (const segment of cookieHeader.split(";")) {
    const [cookieName, ...value] = segment.trim().split("=")
    if (cookieName === name) return value.join("=")
  }
  return undefined
}

export type CsrfProtection = {
  readonly issue: (context: Context) => Response
  readonly isValid: (context: Context) => boolean
}

const equal = (left: string, right: string): boolean =>
  left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right))

export const createCsrfProtection = (secret: Uint8Array = randomBytes(32)): CsrfProtection => {
  const signingKey = Buffer.from(secret)
  const signed = (token: string): string =>
    `${token}.${createHmac("sha256", signingKey).update(token).digest("base64url")}`
  return {
    issue: (context) => {
      const csrfToken = randomBytes(32).toString("base64url")
      context.header("Cache-Control", "no-store")
      context.header(
        "Set-Cookie",
        `${CsrfCookieName}=${signed(csrfToken)}; HttpOnly; Path=/; SameSite=Strict`
      )
      return context.json({ csrfToken })
    },
    isValid: (context) => {
      const cookie = readCookie(context.req.header("cookie"), CsrfCookieName)
      const header = context.req.header("x-csrf-token")
      if (cookie === undefined || header === undefined) return false
      return equal(cookie, signed(header))
    }
  }
}

export const localSecurityMiddleware =
  (settings: LocalSecuritySettings, csrf: CsrfProtection): MiddlewareHandler =>
  async (context, next) => {
    setSecurityHeaders(context)
    const host = requestHost(context)
    if (host === null || !settings.allowedHosts.includes(host))
      return errorResponse(context, "HOST_NOT_ALLOWED", 421)
    if (!requestOriginIsAllowed(context, host))
      return errorResponse(context, "ORIGIN_NOT_ALLOWED", 403)
    if (MutationMethods.has(context.req.method) && !csrf.isValid(context))
      return errorResponse(context, "CSRF_INVALID", 403)
    return next()
  }
