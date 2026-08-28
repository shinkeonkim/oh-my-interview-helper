import { createHash } from "node:crypto"
import { z } from "zod"

import { ToolIdSchema, type ServerTool } from "../agents"
import { fetchPublicText, type PinnedTransport, type Resolver } from "../ingest/safe-fetcher"
import type { LocalSecuritySettings } from "../security/config"

export type PublicSearchResult = {
  readonly url: string
  readonly title: string
  readonly excerpt: string
}
export type PublicSearch = {
  readonly search: (
    query: string,
    limit: number,
    signal: AbortSignal
  ) => Promise<readonly PublicSearchResult[]>
}
const SearchSchema = z
  .object({
    query: z.string().trim().min(2).max(200),
    limit: z.number().int().min(1).max(8).default(5)
  })
  .strict()
const FetchSchema = z.object({ url: z.string().url() }).strict()

export const createPublicResearchTools = (input: {
  readonly limits: LocalSecuritySettings
  readonly search: PublicSearch
  readonly resolver?: Resolver
  readonly transport?: PinnedTransport
}): readonly ServerTool[] => [
  {
    id: ToolIdSchema.parse("public-web-search"),
    schema: SearchSchema,
    requiresCitedResearch: true,
    execute: async (raw, context) => {
      const value = SearchSchema.parse(raw)
      const results = await input.search.search(value.query, value.limit, context.signal)
      return z
        .array(
          z
            .object({
              url: z.string().url(),
              title: z.string().trim().min(1).max(300),
              excerpt: z.string().max(1000)
            })
            .strict()
        )
        .max(value.limit)
        .parse(results)
    }
  },
  {
    id: ToolIdSchema.parse("public-web-fetch"),
    schema: FetchSchema,
    requiresCitedResearch: true,
    execute: async (raw) => {
      const fetched = await fetchPublicText({
        limits: input.limits,
        resolver: input.resolver,
        transport: input.transport,
        url: FetchSchema.parse(raw).url
      })
      return {
        url: fetched.url,
        contentType: fetched.contentType,
        contentBoundary: "untrusted_public_web",
        contentHash: createHash("sha256").update(fetched.text).digest("hex"),
        text: fetched.text
      }
    }
  }
]
