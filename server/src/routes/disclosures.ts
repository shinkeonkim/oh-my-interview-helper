import { Hono } from "hono"
import { z } from "zod"

import { DisclosureError, type DisclosureService } from "../disclosures/service"

const error = (code: string): Response => Response.json({ error: { code } }, { status: 400 })

export const createDisclosureRoutes = (service: DisclosureService): Hono => {
  const app = new Hono()
  app.post("/preview", async (context) => {
    try {
      return context.json(service.preview(await context.req.json()), 201)
    } catch (caught) {
      if (caught instanceof DisclosureError || caught instanceof z.ZodError)
        return error(caught.message)
      throw caught
    }
  })
  app.post("/confirm", async (context) => {
    try {
      return context.json(service.confirm(await context.req.json()), 201)
    } catch (caught) {
      if (caught instanceof DisclosureError || caught instanceof z.ZodError)
        return error(caught.message)
      throw caught
    }
  })
  return app
}
