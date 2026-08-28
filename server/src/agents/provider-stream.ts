import type { ProviderEvent, ProviderResult } from "./contracts"

export const collectProviderStream = async (
  stream: AsyncGenerator<ProviderEvent, ProviderResult, undefined>
): Promise<{ readonly events: readonly ProviderEvent[]; readonly result: ProviderResult }> => {
  const events: ProviderEvent[] = []
  let next = await stream.next()
  while (!next.done) {
    events.push(next.value)
    next = await stream.next()
  }
  return { events, result: next.value }
}
