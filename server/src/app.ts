import { Hono } from "hono"
import { serveStatic } from "hono/bun"

import { HEALTH_STATUS } from "@interview-helper/shared"

export const createApp = (): Hono => {
  const app = new Hono()

  app.get("/api/health", (context) => context.json(HEALTH_STATUS))
  app.use("/assets/*", serveStatic({ root: "./server/public" }))
  app.get("/", serveStatic({ root: "./server/public" }))
  app.notFound(async (context) => {
    if (context.req.path.startsWith("/api/")) return context.json({ error: "Not found" }, 404)

    const index = Bun.file("./server/public/index.html")
    return new Response(index, { headers: { "content-type": "text/html; charset=UTF-8" } })
  })

  return app
}
