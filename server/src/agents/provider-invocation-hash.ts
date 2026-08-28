import { createHash } from "node:crypto"
import { z } from "zod"

import type { ProviderInvocation } from "./contracts"

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
    .join(",")}}`
}

export const providerInvocationHash = (invocation: ProviderInvocation): string =>
  createHash("sha256")
    .update(
      canonical({
        providerId: invocation.providerId,
        messages: invocation.messages,
        toolIds: invocation.toolIds,
        output:
          invocation.output.kind === "text"
            ? { kind: "text" }
            : { kind: "structured", schema: z.toJSONSchema(invocation.output.schema) },
        ...(invocation.timeoutMilliseconds === undefined
          ? {}
          : { timeoutMilliseconds: invocation.timeoutMilliseconds })
      })
    )
    .digest("hex")
