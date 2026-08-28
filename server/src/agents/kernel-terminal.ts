import type { ProviderError, ProviderEvent, ProviderResult, ProviderUsage } from "./contracts"

export const terminalFailure = async function* (
  code: ProviderError["code"],
  retryable: boolean,
  usage: ProviderUsage | null
): AsyncGenerator<ProviderEvent, ProviderResult, undefined> {
  const error = { code, retryable }
  yield { kind: "failed", error, usage, cost: null }
  return { kind: "failed", error, usage, cost: null }
}

export const terminalCancelled = async function* (
  usage: ProviderUsage | null
): AsyncGenerator<ProviderEvent, ProviderResult, undefined> {
  yield { kind: "cancelled", usage, cost: null }
  return { kind: "cancelled", usage, cost: null }
}
