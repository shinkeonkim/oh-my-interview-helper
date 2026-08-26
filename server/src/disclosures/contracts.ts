import { createHash } from "node:crypto"

import { z } from "zod"

import { ProviderModeSchema } from "../agents"
import { DisclosureInputRefSchema, type DisclosureInputRef } from "./sources"

export const HashSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const CapabilitySchema = z.enum(["generation", "structured_output", "cited_research"])
export const DisclosureRequestSchema = z
  .object({
    providerId: z.string().trim().min(1),
    mode: ProviderModeSchema,
    model: z.string().trim().min(1),
    action: z.string().trim().min(1),
    capability: CapabilitySchema,
    research: z.boolean(),
    requestHash: HashSchema,
    inputs: z.array(DisclosureInputRefSchema).min(1)
  })
  .strict()
export const DisclosureTokenPayloadSchema = DisclosureRequestSchema.extend({
  version: z.literal(1),
  nonce: z.string().uuid(),
  expiresAt: z.string().datetime(),
  manifestHash: HashSchema
}).strict()
export const DisclosureConfirmationInputSchema = z
  .object({ authorizationToken: z.string().min(1) })
  .strict()
export const DisclosureConsumptionSchema = DisclosureRequestSchema.extend({
  disclosureId: z.string().uuid(),
  runId: z.string().uuid()
}).strict()
export const StoredConfirmationSchema = z.object({
  id: z.string().uuid(),
  nonce: z.string().uuid(),
  providerId: z.string(),
  mode: ProviderModeSchema,
  model: z.string(),
  action: z.string(),
  capability: CapabilitySchema,
  research: z.union([z.literal(0), z.literal(1)]).transform((value) => value === 1),
  requestHash: HashSchema,
  fingerprint: HashSchema,
  inputs: z
    .string()
    .transform((value) => JSON.parse(value))
    .pipe(z.array(DisclosureInputRefSchema)),
  hashes: z
    .string()
    .transform((value) => JSON.parse(value))
    .pipe(z.array(HashSchema)),
  confirmedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  consumedAt: z.string().datetime().nullable()
})
export const DisclosureConfirmationSchema = z.object({
  id: z.string().uuid(),
  confirmedAt: z.string().datetime(),
  expiresAt: z.string().datetime()
})
export type DisclosureRequest = z.output<typeof DisclosureRequestSchema>
export type DisclosureConfirmation = z.output<typeof DisclosureConfirmationSchema>
export type DisclosurePreview = {
  readonly manifest: DisclosureManifest
  readonly authorizationToken: string
}
export type DisclosureManifest = {
  readonly destination: string
  readonly providerId: string
  readonly mode: string
  readonly model: string
  readonly action: string
  readonly capability: string
  readonly research: boolean
  readonly inputs: readonly {
    readonly type: string
    readonly hash: string
    readonly label: string
    readonly version: number | null
    readonly parentCurrentId: string | null
  }[]
}
export class DisclosureError extends Error {
  override readonly name = "DisclosureError"
  constructor(
    readonly code:
      | "DISCLOSURE_INVALID"
      | "DISCLOSURE_EXPIRED"
      | "DISCLOSURE_STALE"
      | "DISCLOSURE_CONSUMED"
      | "PROVIDER_CONFIGURATION_CHANGED"
  ) {
    super(code)
  }
}
export const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
    .join(",")}}`
}
export const sha256 = (value: unknown): string =>
  createHash("sha256").update(canonical(value)).digest("hex")
export const sameRequest = (
  request: z.output<typeof DisclosureConsumptionSchema>,
  stored: z.output<typeof StoredConfirmationSchema>
): boolean =>
  request.providerId === stored.providerId &&
  request.mode === stored.mode &&
  request.model === stored.model &&
  request.action === stored.action &&
  request.capability === stored.capability &&
  request.research === stored.research &&
  request.requestHash === stored.requestHash

export { DisclosureInputRefSchema, type DisclosureInputRef }
