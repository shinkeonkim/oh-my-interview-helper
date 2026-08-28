import { Hono } from "hono"
import { z } from "zod"

import { DraftArtifactError } from "../artifacts/draft-artifact-repository"
import { CurrentGenerationContextError } from "../artifacts/draft-artifact-service"
import type { DraftArtifactService } from "../artifacts/draft-artifact-service"

const error = (code: string, status = 400): Response =>
  Response.json({ error: { code } }, { status })
export const createArtifactRoutes = (service: DraftArtifactService): Hono => {
  const app = new Hono()
  app.post("/series", async (context) => {
    try {
      return context.json(service.createSeries(await context.req.json()), 201)
    } catch (caught) {
      if (caught instanceof z.ZodError || caught instanceof DraftArtifactError)
        return error(caught.message)
      throw caught
    }
  })
  app.post("/series/:id/revisions", async (context) => {
    try {
      return context.json(
        service.createRevision({
          ...(await context.req.json()),
          seriesId: context.req.param("id")
        }),
        201
      )
    } catch (caught) {
      if (
        caught instanceof z.ZodError ||
        caught instanceof DraftArtifactError ||
        caught instanceof CurrentGenerationContextError
      )
        return error(caught.message)
      throw caught
    }
  })
  app.get("/series/:id/revisions", (context) =>
    context.json({ revisions: service.listRevisions(context.req.param("id")) })
  )
  app.get("/revisions/:id/provenance", (context) => {
    try {
      return context.json(service.getProvenance(context.req.param("id")))
    } catch (caught) {
      if (caught instanceof DraftArtifactError) return error(caught.code, 404)
      throw caught
    }
  })
  app.get("/revisions/:id/export", (context) => {
    const revision = service.getRevision(context.req.param("id"))
    return revision === null
      ? error("ARTIFACT_REVISION_NOT_FOUND", 404)
      : context.json({ content: revision.content })
  })
  app.post("/series/:id/archive", (context) => {
    service.archive(context.req.param("id"))
    return context.body(null, 204)
  })
  app.delete("/series/:id", (context) => {
    service.logicalDelete(context.req.param("id"))
    return context.body(null, 204)
  })
  return app
}
