import { z } from "zod"

import {
  ProviderIdSchema,
  ProviderKernel,
  ProviderRegistry,
  ToolRegistry,
  type ProviderRegistration
} from "../src/agents"
import { FakeModel, FakeModelProbe, type FakeModelStep } from "./fake-model"

export const request = {
  providerId: "fake",
  messages: [{ role: "user" as const, content: [{ kind: "text" as const, text: "hello" }] }],
  output: { kind: "text" as const },
  toolIds: []
}
export const structuredSchema = z.object({ answer: z.string().min(1) })
export const registration = (
  steps: readonly FakeModelStep[],
  probe = new FakeModelProbe(),
  id = "fake",
  capabilities = { generation: true, structuredOutput: true, citedResearch: false },
  enabled = true,
  health: ProviderRegistration["health"] = async () => ({ kind: "healthy" })
): { readonly registration: ProviderRegistration; readonly probe: FakeModelProbe } => ({
  registration: {
    descriptor: {
      id: ProviderIdSchema.parse(id),
      mode: "test",
      model: { id: `${id}-model`, displayName: id, maxOutputTokens: 128 },
      capabilities
    },
    enabled,
    createModel: () => new FakeModel({ modelId: `${id}-model`, steps, probe }),
    health
  },
  probe
})
export const kernelFor = (
  registration: ProviderRegistration,
  tools = new ToolRegistry([])
): ProviderKernel => new ProviderKernel({ providers: new ProviderRegistry([registration]), tools })
