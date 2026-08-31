import { readFileSync } from "node:fs"

import { AnthropicModel } from "@strands-agents/sdk/models/anthropic"
import { OpenAIModel } from "@strands-agents/sdk/models/openai"
import {
  Model,
  type BaseModelConfig,
  type Message,
  type ModelStreamEvent,
  type StreamOptions
} from "@strands-agents/sdk"
import { z } from "zod"

import { ProviderIdSchema } from "../agents/contracts"
import type { ProviderHealth } from "../agents/contracts"
import { ProviderRegistry, type ProviderRegistration } from "../agents/registry"
import type { RawEnvironment } from "../config"

const SecretSchema = z.string().trim().min(1).max(16_384)
const ModelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9._:-]+$/)
const BaseUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value)
    return url.protocol === "https:" || url.hostname === "127.0.0.1" || url.hostname === "localhost"
  })

export type DirectApiProviderKind = "anthropic" | "openai"
export type DirectApiProviderConfig = {
  readonly kind: DirectApiProviderKind
  readonly apiKey: string
  readonly baseUrl?: string
  readonly model: string
  readonly allowedModels: readonly string[]
  readonly maxOutputTokens: number
  readonly requestTimeoutMilliseconds: number
}

export type DirectApiProviderEnvironment = RawEnvironment & {
  readonly ANTHROPIC_API_KEY?: string
  readonly ANTHROPIC_API_KEY_FILE?: string
  readonly ANTHROPIC_MODEL?: string
  readonly ANTHROPIC_ALLOWED_MODELS?: string
  readonly ANTHROPIC_BASE_URL?: string
  readonly OPENAI_API_KEY?: string
  readonly OPENAI_API_KEY_FILE?: string
  readonly OPENAI_MODEL?: string
  readonly OPENAI_ALLOWED_MODELS?: string
  readonly OPENAI_BASE_URL?: string
}

const defaults = {
  anthropic: { model: "claude-sonnet-4-20250514", maxOutputTokens: 8_192 },
  openai: { model: "gpt-5.4", maxOutputTokens: 8_192 }
} as const

const prefix = (kind: DirectApiProviderKind): "ANTHROPIC" | "OPENAI" =>
  kind === "anthropic" ? "ANTHROPIC" : "OPENAI"

const readSecret = (
  kind: DirectApiProviderKind,
  environment: DirectApiProviderEnvironment
): string | null => {
  const name = prefix(kind)
  const direct = environment[`${name}_API_KEY`]
  const file = environment[`${name}_API_KEY_FILE`]
  if (direct !== undefined && file !== undefined)
    throw new DirectApiConfigurationError(kind, "ambiguous_secret")
  if (direct === undefined && file === undefined) return null
  try {
    return SecretSchema.parse(direct ?? readFileSync(file as string, "utf8"))
  } catch {
    throw new DirectApiConfigurationError(kind, "invalid_secret")
  }
}

export const loadDirectApiProviderConfig = (
  kind: DirectApiProviderKind,
  environment: DirectApiProviderEnvironment
): DirectApiProviderConfig | null => {
  const apiKey = readSecret(kind, environment)
  if (apiKey === null) return null
  const name = prefix(kind)
  const model = ModelIdSchema.parse(environment[`${name}_MODEL`] ?? defaults[kind].model)
  const allowedModels = (environment[`${name}_ALLOWED_MODELS`] ?? model)
    .split(",")
    .map((value) => ModelIdSchema.parse(value))
  if (!allowedModels.includes(model)) throw new DirectApiConfigurationError(kind, "model_denied")
  const rawBaseUrl = environment[`${name}_BASE_URL`]
  return {
    kind,
    apiKey,
    ...(rawBaseUrl === undefined ? {} : { baseUrl: BaseUrlSchema.parse(rawBaseUrl) }),
    model,
    allowedModels: [...new Set(allowedModels)],
    maxOutputTokens: defaults[kind].maxOutputTokens,
    requestTimeoutMilliseconds: 60_000
  }
}

type HealthFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

type DirectModelConfig = BaseModelConfig & { readonly modelId: string }

class DirectApiModel extends Model<DirectModelConfig> {
  private modelConfig: DirectModelConfig

  constructor(
    private readonly providerConfig: DirectApiProviderConfig,
    private readonly baseUrl: string,
    private readonly modelFetch: HealthFetch
  ) {
    super()
    this.modelConfig = { modelId: providerConfig.model }
  }

  updateConfig(config: DirectModelConfig): void {
    this.modelConfig = { ...config, modelId: this.providerConfig.model }
  }

  getConfig(): DirectModelConfig {
    return this.modelConfig
  }

  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    const requestFetch: HealthFetch = (input, init) => {
      const signal = combineSignals(init?.signal, options?.cancelSignal)
      return this.modelFetch(input, signal === undefined ? init : { ...init, signal })
    }
    const inner = createVendorModel(this.providerConfig, this.baseUrl, requestFetch)
    yield* inner.stream(messages, options)
  }
}

const combineSignals = (
  left: AbortSignal | null | undefined,
  right: AbortSignal | null | undefined
): AbortSignal | undefined => {
  const signals = [left, right].filter(
    (signal): signal is AbortSignal => signal !== null && signal !== undefined
  )
  return signals.length === 0 ? undefined : AbortSignal.any(signals)
}

const createVendorModel = (
  config: DirectApiProviderConfig,
  baseUrl: string,
  modelFetch: HealthFetch
): Model =>
  config.kind === "anthropic"
    ? new AnthropicModel({
        apiKey: config.apiKey,
        modelId: config.model,
        maxTokens: config.maxOutputTokens,
        clientConfig: {
          baseURL: baseUrl,
          timeout: config.requestTimeoutMilliseconds,
          maxRetries: 0,
          fetch: modelFetch
        }
      })
    : new OpenAIModel({
        api: "responses",
        apiKey: config.apiKey,
        modelId: config.model,
        maxTokens: config.maxOutputTokens,
        stateful: false,
        clientConfig: {
          baseURL: baseUrl,
          timeout: config.requestTimeoutMilliseconds,
          maxRetries: 0,
          fetch: modelFetch
        }
      })

export const createDirectApiProvider = (
  config: DirectApiProviderConfig,
  healthFetch: HealthFetch = fetch,
  modelFetch: HealthFetch = fetch
): ProviderRegistration => {
  const providerId = ProviderIdSchema.parse(`${config.kind}-api`)
  const baseUrl =
    config.baseUrl ??
    (config.kind === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1")
  return {
    descriptor: {
      id: providerId,
      mode: "api",
      model: {
        id: config.model,
        displayName: config.model,
        maxOutputTokens: config.maxOutputTokens
      },
      capabilities: { generation: true, structuredOutput: true, citedResearch: true }
    },
    enabled: true,
    createModel: () => new DirectApiModel(config, baseUrl, modelFetch),
    health: () => probeHealth(config, baseUrl, healthFetch)
  }
}

export const createDirectApiProviderRegistry = (
  environment: DirectApiProviderEnvironment,
  healthFetch: HealthFetch = fetch
): ProviderRegistry =>
  new ProviderRegistry(
    (["anthropic", "openai"] as const).flatMap((kind) => {
      const config = loadDirectApiProviderConfig(kind, environment)
      return config === null ? [] : [createDirectApiProvider(config, healthFetch)]
    })
  )

const probeHealth = async (
  config: DirectApiProviderConfig,
  baseUrl: string,
  healthFetch: HealthFetch
): Promise<ProviderHealth> => {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    Math.min(config.requestTimeoutMilliseconds, 5_000)
  )
  try {
    const endpoint = config.kind === "anthropic" ? `${baseUrl}/v1/models` : `${baseUrl}/models`
    const response = await healthFetch(endpoint, {
      headers:
        config.kind === "anthropic"
          ? { "anthropic-version": "2023-06-01", "x-api-key": config.apiKey }
          : { authorization: `Bearer ${config.apiKey}` },
      signal: controller.signal
    })
    return response.ok ? { kind: "healthy" } : { kind: "unavailable", code: "unreachable" }
  } catch {
    return { kind: "unavailable", code: "unreachable" }
  } finally {
    clearTimeout(timeout)
  }
}

export class DirectApiConfigurationError extends Error {
  override readonly name = "DirectApiConfigurationError"
  constructor(
    readonly provider: DirectApiProviderKind,
    readonly code: "ambiguous_secret" | "invalid_secret" | "model_denied"
  ) {
    super(`DIRECT_API_CONFIGURATION_ERROR: ${provider}:${code}`)
  }
}
