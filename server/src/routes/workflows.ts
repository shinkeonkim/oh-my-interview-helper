import { Hono } from "hono"
import { z } from "zod"

import { DraftArtifactError } from "../artifacts/draft-artifact-repository"
import { CurrentGenerationContextError } from "../artifacts/draft-artifact-service"
import {
  PreparationExecutorError,
  PreparationWorkflowError,
  type PreparationWorkflowService
} from "../workflows/service"
import { safeErrorCode } from "../security/redaction"

export const createWorkflowRoutes = (service: PreparationWorkflowService): Hono => {
  const routes = new Hono()
  routes.post("/run", async (context) => {
    try {
      return context.json(await service.run(await context.req.json(), context.req.raw.signal), 201)
    } catch (error) {
      if (error instanceof PreparationExecutorError)
        return context.json(safeErrorCode(error, error.code.toUpperCase()), 503)
      if (
        error instanceof z.ZodError ||
        error instanceof PreparationWorkflowError ||
        error instanceof DraftArtifactError ||
        error instanceof CurrentGenerationContextError
      )
        return context.json(safeErrorCode(error, "PREPARATION_REJECTED"), 422)
      throw error
    }
  })
  return routes
}
