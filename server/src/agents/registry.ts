import { tool, type InvokableTool, type Model } from "@strands-agents/sdk"
import type { z } from "zod"

import { ProviderIdSchema, ToolIdSchema } from "./contracts"
import type { ProviderDescriptor, ProviderHealth, ProviderId, ToolId } from "./contracts"

export type ProviderRegistration = {
  readonly descriptor: ProviderDescriptor
  readonly enabled: boolean
  readonly createModel: () => Model
  readonly health: () => Promise<ProviderHealth>
}
export type ServerTool = {
  readonly id: ToolId
  readonly schema: z.ZodType
  readonly requiresCitedResearch?: boolean
  readonly execute: (
    input: unknown,
    context: { readonly signal: AbortSignal }
  ) => unknown | Promise<unknown>
}
export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, ProviderRegistration>()
  constructor(registrations: readonly ProviderRegistration[]) {
    for (const registration of registrations) {
      if (this.providers.has(registration.descriptor.id))
        throw new ProviderRegistryError("duplicate")
      this.providers.set(registration.descriptor.id, registration)
    }
  }
  get(id: string): ProviderRegistration | null {
    return this.providers.get(ProviderIdSchema.parse(id)) ?? null
  }
  list(): readonly ProviderRegistration[] {
    return [...this.providers.values()]
  }
  async health(id: string): Promise<ProviderHealth> {
    const provider = this.get(id)
    if (provider === null) return { kind: "unavailable", code: "unconfigured" }
    if (!provider.enabled) return { kind: "unavailable", code: "disabled" }
    return provider.health()
  }
}
export class ToolRegistry {
  private readonly tools = new Map<ToolId, ServerTool>()
  constructor(tools: readonly ServerTool[]) {
    for (const entry of tools) {
      if (this.tools.has(entry.id)) throw new ProviderRegistryError("duplicate")
      this.tools.set(entry.id, entry)
    }
  }
  select(ids: readonly string[]): readonly InvokableTool<unknown, unknown>[] {
    return ids.map((rawId) => {
      const id = ToolIdSchema.parse(rawId)
      const entry = this.tools.get(id)
      if (entry === undefined) throw new ProviderRegistryError("tool_denied")
      return tool({
        name: id,
        description: "Server-approved tool",
        inputSchema: entry.schema,
        callback: (input, context) =>
          entry.execute(input, { signal: context?.cancelSignal ?? new AbortController().signal })
      })
    })
  }
  requiresCitedResearch(ids: readonly string[]): boolean {
    return ids.some((rawId) => {
      const entry = this.tools.get(ToolIdSchema.parse(rawId))
      return entry?.requiresCitedResearch === true
    })
  }
}
export class ProviderRegistryError extends Error {
  override readonly name = "ProviderRegistryError"
  constructor(readonly code: "duplicate" | "tool_denied") {
    super(code)
  }
}
