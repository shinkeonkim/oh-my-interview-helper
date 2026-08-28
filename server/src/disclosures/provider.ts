import type { Database } from "bun:sqlite"
import { z } from "zod"

import type { ProviderRegistry } from "../agents"
import { containsSecretLikeData } from "../jobs/types"
import { DisclosureError, type DisclosureRequest, sha256 } from "./contracts"

const ProviderSettingSchema = z.object({
  selectedModel: z.string().nullable(),
  enabled: z.union([z.literal(0), z.literal(1)]).transform((value) => value === 1),
  capabilities: z
    .string()
    .transform((value) => JSON.parse(value))
    .pipe(z.record(z.string(), z.json()))
})

export const providerFingerprint = (
  database: Database,
  providers: ProviderRegistry,
  request: DisclosureRequest
): string => {
  const provider = providers.get(request.providerId)
  if (
    provider === null ||
    !provider.enabled ||
    provider.descriptor.mode !== request.mode ||
    provider.descriptor.model.id !== request.model
  )
    throw new DisclosureError("PROVIDER_CONFIGURATION_CHANGED")
  const row = database
    .query<unknown, [string]>(
      "SELECT selected_model selectedModel,enabled,capability_json capabilities FROM provider_settings WHERE provider_kind=?"
    )
    .get(request.providerId)
  const setting = ProviderSettingSchema.nullable().parse(row)
  if (
    setting === null ||
    !setting.enabled ||
    setting.selectedModel !== request.model ||
    containsSecretLikeData(setting.capabilities)
  )
    throw new DisclosureError("PROVIDER_CONFIGURATION_CHANGED")
  const capability =
    request.capability === "generation"
      ? provider.descriptor.capabilities.generation
      : request.capability === "structured_output"
        ? provider.descriptor.capabilities.structuredOutput
        : provider.descriptor.capabilities.citedResearch
  if (!capability || (request.research && !provider.descriptor.capabilities.citedResearch))
    throw new DisclosureError("PROVIDER_CONFIGURATION_CHANGED")
  return sha256({ descriptor: provider.descriptor, setting })
}
