import { Hono } from "hono"
import { z } from "zod"

import type { RunnerPairingService } from "../runner/pairing"

const RunnerNameParameterSchema = z.string().trim().min(1).max(128)

export const createRunnerRoutes = (pairing: RunnerPairingService): Hono => {
  const routes = new Hono()

  routes.post("/pairing-code", (context) => {
    context.header("Cache-Control", "no-store")
    return context.json(pairing.issueCode(), 201)
  })

  routes.delete("/:runnerName", (context) => {
    const parsed = RunnerNameParameterSchema.safeParse(context.req.param("runnerName"))
    if (!parsed.success) return context.json({ error: { code: "INVALID_RUNNER_NAME" } }, 400)
    pairing.revoke(parsed.data)
    return context.body(null, 204)
  })

  return routes
}
