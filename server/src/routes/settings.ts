import { Hono } from "hono"
import { z } from "zod"

import type { ProviderRegistry } from "../agents"
import type { OperationsRepositories } from "../db/operations-repositories"
import { ProviderKindSchema } from "../db/operations-repository-schemas"
import { containsSecretLikeData } from "../jobs/types"

const BodySchema = z
  .object({
    selectedModel: z.string().trim().min(1).nullable(),
    enabled: z.boolean(),
    capabilities: z.record(z.string(), z.boolean())
  })
  .strict()
const error = (code: string): Response => Response.json({ error: { code } }, { status: 400 })

export const createSettingsRoutes = (dependencies: {
  readonly operations: OperationsRepositories
  readonly providers: ProviderRegistry
}): Hono => {
  const app = new Hono()
  app.put("/providers/:providerId", async (context) => {
    let input: unknown
    try {
      input = await context.req.json()
    } catch (caught) {
      if (caught instanceof SyntaxError) return error("SETTINGS_REQUEST_INVALID")
      throw caught
    }
    if (containsSecretLikeData(input)) return error("SETTINGS_SECRET_REJECTED")
    const body = BodySchema.safeParse(input)
    if (!body.success) return error("SETTINGS_REQUEST_INVALID")
    const provider = dependencies.providers.get(context.req.param("providerId"))
    if (provider === null) return error("PROVIDER_NOT_FOUND")
    if (
      body.data.selectedModel !== null &&
      body.data.selectedModel !== provider.descriptor.model.id
    )
      return error("MODEL_NOT_SUPPORTED")
    const saved = dependencies.operations.upsertProviderSettings({
      providerKind: ProviderKindSchema.parse(provider.descriptor.id),
      ...body.data,
      updatedAt: new Date().toISOString()
    })
    return context.json(saved)
  })
  app.get("/providers", (context) => {
    try {
      return context.json({ providers: dependencies.operations.listProviderSettings() })
    } catch (caught) {
      if (caught instanceof z.ZodError) return error("SETTINGS_STORED_INVALID")
      throw caught
    }
  })
  return app
}

export const createProviderStatusRoutes = (dependencies: {
  readonly operations: OperationsRepositories
  readonly providers: ProviderRegistry
}): Hono => {
  const app = new Hono()
  app.get("/status", (context) => {
    try {
      const settings = new Map(
        dependencies.operations.listProviderSettings().map((entry) => [entry.providerKind, entry])
      )
      return context.json({
        providers: dependencies.providers.list().map((provider) => {
          const configured = settings.get(ProviderKindSchema.parse(provider.descriptor.id))
          return {
            id: provider.descriptor.id,
            mode: provider.descriptor.mode,
            model: provider.descriptor.model,
            capabilities: provider.descriptor.capabilities,
            configured:
              configured?.enabled === true &&
              configured.selectedModel === provider.descriptor.model.id,
            health: { kind: "not_checked" }
          }
        })
      })
    } catch (caught) {
      if (caught instanceof z.ZodError) return error("SETTINGS_STORED_INVALID")
      throw caught
    }
  })
  return app
}
