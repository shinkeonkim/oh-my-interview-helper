import { Hono } from "hono"
import { serveStatic } from "hono/bun"
import { bodyLimit } from "hono/body-limit"

import { HEALTH_STATUS } from "@interview-helper/shared"

import { createPreviewRoutes } from "./routes/preview"
import { defaultLocalSecuritySettings, type LocalSecuritySettings } from "./security/config"
import type { PinnedTransport, Resolver } from "./ingest/safe-fetcher"
import { createCsrfProtection, localSecurityMiddleware } from "./security/local-security"

export type AppOptions = {
  readonly dataDirectory?: string
  readonly resolver?: Resolver
  readonly security?: LocalSecuritySettings
  readonly transport?: PinnedTransport
  readonly csrfSecret?: Uint8Array
}

export const createApp = ({
  dataDirectory = "./data",
  resolver,
  security = defaultLocalSecuritySettings(),
  transport,
  csrfSecret
}: AppOptions = {}): Hono => {
  const app = new Hono()
  const csrf = createCsrfProtection(csrfSecret)

  app.use("*", localSecurityMiddleware(security, csrf))
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: security.requestBytes,
      onError: (context) => context.json({ error: { code: "REQUEST_TOO_LARGE" } }, 413)
    })
  )
  app.get("/api/health", (context) => context.json(HEALTH_STATUS))
  app.get("/api/security/csrf", csrf.issue)
  app.route(
    "/api/preview",
    createPreviewRoutes({ dataDirectory, limits: security, resolver, transport })
  )
  app.use("/assets/*", serveStatic({ root: "./server/public" }))
  app.get("/", serveStatic({ root: "./server/public" }))
  app.notFound(async (context) => {
    if (context.req.path.startsWith("/api/")) return context.json({ error: "Not found" }, 404)

    const index = Bun.file("./server/public/index.html")
    return new Response(index, { headers: { "content-type": "text/html; charset=UTF-8" } })
  })

  return app
}
