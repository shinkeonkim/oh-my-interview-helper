import { Hono, type Context } from "hono"
import { z } from "zod"

import { ResearchIntegrityError } from "../research/repository"
import { ResearchSourceUrlSchema } from "../research/contracts"
import { ResearchServiceError, type ResearchService } from "../research/service"
import { safeErrorCode } from "../security/redaction"

const failure = (context: Context, error: unknown) => {
  if (error instanceof ResearchIntegrityError || error instanceof ResearchServiceError)
    return context.json(
      safeErrorCode(error, error.code.toUpperCase()),
      error.code === "analyzer_unavailable" ? 503 : 422
    )
  return context.json(safeErrorCode(error, "RESEARCH_OPERATION_FAILED"), 400)
}
export const createResearchRoutes = (service: ResearchService): Hono => {
  const routes = new Hono()
  routes.get("/", (context) => {
    try {
      const raw = context.req.query("jobPostId")
      const jobPostId = raw === undefined ? null : z.string().uuid().parse(raw)
      return context.json({ records: service.repository.list(jobPostId) })
    } catch (error) {
      return failure(context, error)
    }
  })
  routes.post("/", async (context) => {
    try {
      return context.json(await service.run(await context.req.json()), 201)
    } catch (error) {
      return failure(context, error)
    }
  })
  routes.get("/:id", (context) => {
    try {
      const record = service.repository.get(context.req.param("id"))
      return record === null
        ? context.json({ error: { code: "NOT_FOUND" } }, 404)
        : context.json(record)
    } catch (error) {
      return failure(context, error)
    }
  })
  routes.post("/:id/refresh", async (context) => {
    try {
      const body = z
        .object({ sourceUrls: z.array(ResearchSourceUrlSchema).min(1).max(8) })
        .strict()
        .parse(await context.req.json())
      return context.json(await service.refresh(context.req.param("id"), body.sourceUrls), 201)
    } catch (error) {
      return failure(context, error)
    }
  })
  return routes
}
