import { Hono } from "hono"
import { z } from "zod"

import { JobDiscoveryError, type JobDiscoveryService } from "../job-search/service"
import { safeErrorCode } from "../security/redaction"

export const createJobSearchRoutes = (service: JobDiscoveryService): Hono => {
  const routes = new Hono()
  routes.post("/discover", async (context) => {
    try {
      return context.json(await service.discover(await context.req.json(), context.req.raw.signal))
    } catch (error) {
      if (error instanceof z.ZodError)
        return context.json(safeErrorCode(error, "JOB_DISCOVERY_REJECTED"), 422)
      if (error instanceof JobDiscoveryError)
        return context.json(safeErrorCode(error, error.code.toUpperCase()), 503)
      throw error
    }
  })
  return routes
}
