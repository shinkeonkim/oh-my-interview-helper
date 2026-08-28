import { z } from "zod"

export const JobStateSchema = z.enum([
  "queued",
  "leased",
  "running",
  "succeeded",
  "failed",
  "cancelled"
])

export const JobSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  state: JobStateSchema,
  idempotencyKey: z.string().uuid(),
  payload: z.record(z.string(), z.json()),
  retryClass: z.enum(["local", "external"]),
  attemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  cancellationRequestedAt: z.string().datetime().nullable(),
  leaseOwner: z.string().nullable(),
  leaseExpiresAt: z.string().datetime().nullable(),
  nextAttemptAt: z.string().datetime().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable()
})

export type Job = z.output<typeof JobSchema>

export const EventSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  sequence: z.number().int().positive(),
  kind: z.string(),
  payload: z.record(z.string(), z.json()),
  createdAt: z.string().datetime()
})

export type JobEvent = z.output<typeof EventSchema>

export const jobInput = (kind = "test.local") => ({
  id: crypto.randomUUID(),
  kind,
  input: { label: kind },
  idempotencyKey: crypto.randomUUID(),
  retryClass: "local",
  maxAttempts: 2
})

export const call = (target: object, name: string, input: object): unknown => {
  const candidate = Reflect.get(target, name)
  if (typeof candidate !== "function") throw new Error(`Missing durable jobs method: ${name}`)
  return Reflect.apply(candidate, target, [input])
}

export const jobRepository = (persistence: { readonly repositories: object }): object => {
  const candidate = Reflect.get(persistence.repositories, "jobs")
  if (typeof candidate !== "object" || candidate === null)
    throw new Error("Durable jobs repository is absent")
  return candidate
}
