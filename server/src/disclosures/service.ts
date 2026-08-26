import { randomUUID } from "node:crypto"

import type { Database } from "bun:sqlite"
import type { z } from "zod"

import type { ProviderRegistry } from "../agents"
import { DisclosureSourceError, DisclosureSourceResolver } from "./sources"
import {
  DisclosureConfirmationInputSchema,
  DisclosureConfirmationSchema,
  DisclosureConsumptionSchema,
  DisclosureError,
  DisclosureRequestSchema,
  DisclosureTokenPayloadSchema,
  StoredConfirmationSchema,
  canonical,
  sameRequest,
  sha256,
  type DisclosureConfirmation,
  type DisclosurePreview,
  type DisclosureRequest
} from "./contracts"
import { providerFingerprint } from "./provider"
import { DisclosureTokenCodec } from "./token"

export class DisclosureService {
  private readonly resolver: DisclosureSourceResolver
  private readonly tokens: DisclosureTokenCodec
  private readonly now: () => Date
  private readonly lifetimeMilliseconds: number
  constructor(
    private readonly dependencies: {
      readonly database: Database
      readonly providers: ProviderRegistry
      readonly secret: Uint8Array
      readonly now?: () => Date
      readonly lifetimeMilliseconds?: number
    }
  ) {
    this.resolver = new DisclosureSourceResolver(dependencies.database)
    this.tokens = new DisclosureTokenCodec(dependencies.secret)
    this.now = dependencies.now ?? (() => new Date())
    this.lifetimeMilliseconds = dependencies.lifetimeMilliseconds ?? 300_000
  }
  preview(input: DisclosureRequest): DisclosurePreview {
    const request = DisclosureRequestSchema.parse(input)
    const resolved = request.inputs.map((reference) => this.resolver.resolve(reference))
    const fingerprint = providerFingerprint(
      this.dependencies.database,
      this.dependencies.providers,
      request
    )
    const manifest = this.manifest(request, resolved)
    const expiresAt = new Date(this.now().getTime() + this.lifetimeMilliseconds).toISOString()
    const payload = DisclosureTokenPayloadSchema.parse({
      ...request,
      version: 1,
      nonce: randomUUID(),
      expiresAt,
      manifestHash: sha256({ manifest, fingerprint })
    })
    return { manifest, authorizationToken: this.tokens.sign(payload) }
  }
  confirm(input: z.input<typeof DisclosureConfirmationInputSchema>): DisclosureConfirmation {
    const payload = this.tokens.verify(
      DisclosureConfirmationInputSchema.parse(input).authorizationToken
    )
    if (this.now().toISOString() >= payload.expiresAt)
      throw new DisclosureError("DISCLOSURE_EXPIRED")
    const request = DisclosureRequestSchema.parse({
      providerId: payload.providerId,
      mode: payload.mode,
      model: payload.model,
      action: payload.action,
      capability: payload.capability,
      research: payload.research,
      requestHash: payload.requestHash,
      inputs: payload.inputs
    })
    const resolved = request.inputs.map((reference) => this.resolver.resolve(reference))
    const fingerprint = providerFingerprint(
      this.dependencies.database,
      this.dependencies.providers,
      request
    )
    const manifest = this.manifest(request, resolved)
    if (payload.manifestHash !== sha256({ manifest, fingerprint }))
      throw new DisclosureError("DISCLOSURE_STALE")
    return this.persistConfirmation(
      payload,
      request,
      resolved.map((entry) => entry.hash),
      fingerprint
    )
  }
  consume(input: z.input<typeof DisclosureConsumptionSchema>): DisclosureConfirmation {
    const request = DisclosureConsumptionSchema.parse(input)
    return this.dependencies.database
      .transaction(() => this.consumeTransaction(request))
      .immediate()
  }
  list(): readonly DisclosureConfirmation[] {
    return this.dependencies.database
      .query<unknown, []>(
        "SELECT id,confirmed_at confirmedAt,expires_at expiresAt FROM disclosure_confirmations ORDER BY confirmed_at,id"
      )
      .all()
      .map((row) => DisclosureConfirmationSchema.parse(row))
  }
  consumeForProviderRun(input: {
    readonly disclosureId?: string | undefined
    readonly runId: string
    readonly providerId: string
    readonly mode: "api" | "runner" | "test"
    readonly model: string
    readonly requestHash: string
  }): boolean {
    if (input.disclosureId === undefined) return false
    const stored = this.readStored(input.disclosureId)
    if (stored === null) return false
    try {
      this.consume({
        providerId: input.providerId,
        mode: input.mode,
        model: input.model,
        action: stored.action,
        capability: stored.capability,
        research: stored.research,
        requestHash: input.requestHash,
        inputs: stored.inputs,
        disclosureId: stored.id,
        runId: input.runId
      })
      return true
    } catch (error) {
      if (error instanceof DisclosureError || error instanceof DisclosureSourceError) return false
      throw error
    }
  }
  private persistConfirmation(
    payload: z.output<typeof DisclosureTokenPayloadSchema>,
    request: DisclosureRequest,
    hashes: readonly string[],
    fingerprint: string
  ): DisclosureConfirmation {
    const id = randomUUID()
    const confirmedAt = this.now().toISOString()
    try {
      this.dependencies.database.run(
        "INSERT INTO disclosure_confirmations (id,nonce,provider_id,provider_mode,model,action,capability,research_enabled,request_hash,provider_fingerprint,input_manifest_json,input_hashes_json,manifest_hash,confirmed_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          id,
          payload.nonce,
          request.providerId,
          request.mode,
          request.model,
          request.action,
          request.capability,
          Number(request.research),
          request.requestHash,
          fingerprint,
          JSON.stringify(request.inputs),
          JSON.stringify(hashes),
          payload.manifestHash,
          confirmedAt,
          payload.expiresAt
        ]
      )
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE"))
        throw new DisclosureError("DISCLOSURE_CONSUMED")
      throw error
    }
    return { id, confirmedAt, expiresAt: payload.expiresAt }
  }
  private consumeTransaction(
    request: z.output<typeof DisclosureConsumptionSchema>
  ): DisclosureConfirmation {
    const stored = this.readStored(request.disclosureId)
    if (stored === null) throw new DisclosureError("DISCLOSURE_INVALID")
    if (stored.consumedAt !== null) throw new DisclosureError("DISCLOSURE_CONSUMED")
    if (this.now().toISOString() >= stored.expiresAt)
      throw new DisclosureError("DISCLOSURE_EXPIRED")
    if (!sameRequest(request, stored)) throw new DisclosureError("DISCLOSURE_STALE")
    const hashes = stored.inputs.map((reference) => this.resolver.resolve(reference).hash)
    if (canonical(hashes) !== canonical(stored.hashes))
      throw new DisclosureError("DISCLOSURE_STALE")
    if (
      providerFingerprint(this.dependencies.database, this.dependencies.providers, request) !==
      stored.fingerprint
    )
      throw new DisclosureError("PROVIDER_CONFIGURATION_CHANGED")
    if (
      this.dependencies.database.run(
        "UPDATE disclosure_confirmations SET consumed_at=?,bound_run_id=? WHERE id=? AND consumed_at IS NULL",
        [this.now().toISOString(), request.runId, stored.id]
      ).changes !== 1
    )
      throw new DisclosureError("DISCLOSURE_CONSUMED")
    return { id: stored.id, confirmedAt: stored.confirmedAt, expiresAt: stored.expiresAt }
  }
  private readStored(id: string): z.output<typeof StoredConfirmationSchema> | null {
    const row = this.dependencies.database
      .query<unknown, [string]>(
        "SELECT id,nonce,provider_id providerId,provider_mode mode,model,action,capability,research_enabled research,request_hash requestHash,provider_fingerprint fingerprint,input_manifest_json inputs,input_hashes_json hashes,confirmed_at confirmedAt,expires_at expiresAt,consumed_at consumedAt FROM disclosure_confirmations WHERE id=?"
      )
      .get(id)
    return StoredConfirmationSchema.nullable().parse(row)
  }
  private manifest(
    request: DisclosureRequest,
    inputs: readonly ReturnType<DisclosureSourceResolver["resolve"]>[]
  ): DisclosurePreview["manifest"] {
    return {
      destination: request.providerId,
      providerId: request.providerId,
      mode: request.mode,
      model: request.model,
      action: request.action,
      capability: request.capability,
      research: request.research,
      inputs: inputs.map((entry) => ({
        type: entry.type,
        hash: entry.hash,
        label: entry.label,
        version: entry.version,
        parentCurrentId: entry.parentCurrentId
      }))
    }
  }
}

export { DisclosureError, DisclosureInputRefSchema, type DisclosureInputRef } from "./contracts"
export { DisclosureSourceError } from "./sources"
