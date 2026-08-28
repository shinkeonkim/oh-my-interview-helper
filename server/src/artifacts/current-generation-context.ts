import { createHash } from "node:crypto"

import type { ProviderDescriptor } from "../agents/contracts"
import { containsSecretLikeData } from "../jobs/types"
import {
  PromptTemplateRevisionRegistry,
  type PromptTemplateRevision
} from "../prompts/prompt-template-revisions"

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
    .join(",")}}`
}
const digest = (value: unknown): string =>
  createHash("sha256").update(canonical(value)).digest("hex")

export type CurrentProviderContext = {
  readonly providerId: string
  readonly mode: "api" | "runner" | "test"
  readonly model: string
  readonly capabilityRevision: string
}
export type ProviderContextResolution =
  | { readonly kind: "current"; readonly context: CurrentProviderContext }
  | { readonly kind: "disabled" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "changed"; readonly context: CurrentProviderContext }

export type CurrentProviderRegistration = {
  readonly descriptor: ProviderDescriptor
  readonly enabled: boolean
}
export type CurrentProviderSettings = {
  readonly selectedModel: string | null
  readonly enabled: boolean
  readonly capabilities: Record<string, unknown>
}
export type CurrentProviderSource = {
  readonly get: (providerId: string) => CurrentProviderRegistration | null
}
export type CurrentProviderSettingsSource = {
  readonly get: (providerId: string) => CurrentProviderSettings | null
}
export type CurrentGenerationContextResolverDependencies = {
  readonly providers: CurrentProviderSource
  readonly settings: CurrentProviderSettingsSource
  readonly prompts: PromptTemplateRevisionRegistry
}

export class CurrentGenerationContextResolver {
  constructor(private readonly dependencies: CurrentGenerationContextResolverDependencies) {}

  resolveProvider(providerId: string): ProviderContextResolution {
    const provider = this.dependencies.providers.get(providerId)
    if (provider === null) return { kind: "unavailable" }
    const setting = this.dependencies.settings.get(providerId)
    if (setting === null || containsSecretLikeData(setting.capabilities))
      return { kind: "unavailable" }
    if (!provider.enabled || !setting.enabled) return { kind: "disabled" }
    const context = {
      providerId: provider.descriptor.id,
      mode: provider.descriptor.mode,
      model: provider.descriptor.model.id,
      capabilityRevision: digest({
        descriptorCapabilities: provider.descriptor.capabilities,
        settingCapabilities: setting.capabilities
      })
    } satisfies CurrentProviderContext
    return setting.selectedModel === null || setting.selectedModel === provider.descriptor.model.id
      ? { kind: "current", context }
      : { kind: "changed", context }
  }
  resolvePrompt(templateId: string): PromptTemplateRevision | null {
    return this.dependencies.prompts.get(templateId)
  }
}

export { PromptTemplateRevisionRegistry, type PromptTemplateRevision }
