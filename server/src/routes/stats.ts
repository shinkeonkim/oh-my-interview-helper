import type { Database } from "bun:sqlite"
import { Hono } from "hono"
import { z } from "zod"

const startedAt = Date.now()
const CountRow = z.object({ count: z.number().int().nonnegative() })
const UsageRow = z.object({ usage: z.string() })
const KindRow = z.object({ kind: z.string(), count: z.number(), outputTokens: z.number() })

export const createStatsRoutes = (database: Database): Hono => {
  const routes = new Hono()
  routes.get("/overview", (context) => {
    const memory = process.memoryUsage()
    const counts = Object.fromEntries(
      (
        [
          ["postings", "SELECT count(*) count FROM job_posts WHERE state='active'"],
          ["applications", "SELECT count(*) count FROM applications WHERE archived_at IS NULL"],
          ["documents", "SELECT count(*) count FROM documents WHERE state='active'"],
          ["research", "SELECT count(*) count FROM research_records WHERE status='active'"],
          ["conversations", "SELECT count(*) count FROM conversations WHERE archived_at IS NULL"],
          ["messages", "SELECT count(*) count FROM messages"],
          ["interviews", "SELECT count(*) count FROM application_interviews"],
          ["artifacts", "SELECT count(*) count FROM draft_artifact_revisions"]
        ] as const
      ).map(([key, sql]) => [key, CountRow.parse(database.query(sql).get()).count])
    )
    const usages = database
      .query<unknown, []>("SELECT usage_json usage FROM provider_runs")
      .all()
      .map((row) => JSON.parse(UsageRow.parse(row).usage) as { usage?: Record<string, unknown> })
    const tokens = usages.reduce(
      (total, row) => ({
        input: total.input + numeric(row.usage?.["inputTokens"]),
        output: total.output + numeric(row.usage?.["outputTokens"]),
        cache: total.cache + numeric(row.usage?.["cacheTokens"])
      }),
      { input: 0, output: 0, cache: 0 }
    )
    const byKind = database
      .query<unknown, []>(
        `SELECT s.kind kind,count(*) count,COALESCE(sum(CAST(json_extract(p.usage_json,'$.usage.outputTokens') AS INTEGER)),0) outputTokens
         FROM draft_artifact_revisions r
         JOIN draft_artifact_series s ON s.id=r.series_id
         LEFT JOIN provider_runs p ON p.id=r.provider_run_id
         GROUP BY s.kind ORDER BY count DESC`
      )
      .all()
      .map((row) => KindRow.parse(row))
    const providerStates = database
      .query<{ provider: string; status: string; count: number }, []>(
        "SELECT provider_kind provider,status,count(*) count FROM provider_runs GROUP BY provider_kind,status ORDER BY provider,status"
      )
      .all()
    return context.json({
      uptime: { since: new Date(startedAt).toISOString(), milliseconds: Date.now() - startedAt },
      memory: {
        rssMb: mb(memory.rss),
        heapUsedMb: mb(memory.heapUsed),
        heapTotalMb: mb(memory.heapTotal),
        externalMb: mb(memory.external)
      },
      counts,
      providerRuns: { total: usages.length, tokens, byKind, states: providerStates }
    })
  })
  return routes
}

const numeric = (value: unknown): number => (typeof value === "number" ? value : 0)
const mb = (bytes: number): number => Math.round((bytes / 1024 / 1024) * 10) / 10
