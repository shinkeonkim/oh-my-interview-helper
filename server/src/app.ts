import { Hono } from "hono"

import { HEALTH_STATUS } from "@interview-helper/shared"

export const createApp = (): Hono => {
  const app = new Hono()

  app.get("/api/health", (context) => context.json(HEALTH_STATUS))

  return app
}
