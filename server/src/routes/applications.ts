import { Hono, type Context } from "hono"
import { z } from "zod"

import { ApplicationDomainError } from "../applications/repository"
import { ApplicationServiceError, type ApplicationService } from "../applications/service"
import { IngestionError } from "../ingest/file-preview"
import { FetchBoundaryError } from "../ingest/safe-fetcher"
import { safeErrorCode } from "../security/redaction"
import { PublicHttpUrlSchema } from "../security/public-url"

const Id = z.string().uuid()
const Metadata = z
  .object({
    title: z.string().trim().min(1).max(200),
    companyName: z.string().trim().min(1).max(200),
    teamName: z.string().trim().min(1).max(200).nullable().default(null),
    location: z.string().trim().max(200).nullable().default(null),
    employmentType: z.string().trim().max(100).nullable().default(null)
  })
  .strict()
const ManualPost = Metadata.extend({ text: z.string().min(1).max(1_000_000) }).strict()
const UrlPost = Metadata.extend({ url: PublicHttpUrlSchema }).strict()

const failure = (context: Context, error: unknown) => {
  if (error instanceof IngestionError)
    return context.json(
      safeErrorCode(error, error.code),
      error.code === "FILE_TOO_LARGE" ? 413 : 422
    )
  if (error instanceof FetchBoundaryError)
    return context.json(safeErrorCode(error, error.code), 422)
  if (error instanceof ApplicationDomainError || error instanceof ApplicationServiceError) {
    const status =
      error.code === "idempotency_conflict" ||
      error.code === "active_application_exists" ||
      error.code === "transition_denied"
        ? 409
        : 400
    return context.json(safeErrorCode(error, error.code.toUpperCase()), status)
  }
  return context.json(safeErrorCode(error, "APPLICATION_OPERATION_FAILED"), 400)
}
const metadataFromForm = (form: FormData) =>
  Metadata.parse({
    title: form.get("title"),
    companyName: form.get("companyName"),
    teamName: form.get("teamName") || null,
    location: form.get("location") || null,
    employmentType: form.get("employmentType") || null
  })

export const createApplicationRoutes = (service: ApplicationService): Hono => {
  const routes = new Hono()
  const repository = service.repository

  routes.get("/postings", (context) => context.json({ postings: repository.posts() }))
  routes.post("/postings/manual", async (context) => {
    try {
      return context.json(
        await service.createManual(ManualPost.parse(await context.req.json())),
        201
      )
    } catch (error) {
      return failure(context, error)
    }
  })
  routes.post("/postings/url", async (context) => {
    try {
      return context.json(await service.createUrl(UrlPost.parse(await context.req.json())), 201)
    } catch (error) {
      return failure(context, error)
    }
  })
  routes.post("/postings/file", async (context) => {
    try {
      const form = await context.req.formData()
      const file = form.get("file")
      if (!(file instanceof File)) return context.json({ error: { code: "FILE_REQUIRED" } }, 400)
      return context.json(await service.createFile({ ...metadataFromForm(form), file }), 201)
    } catch (error) {
      return failure(context, error)
    }
  })
  routes.get("/postings/:id/pipeline/stages", (context) => {
    try {
      return context.json({ stages: repository.postStages(context.req.param("id")) })
    } catch (error) {
      return failure(context, error)
    }
  })
  routes.post("/postings/:id/pipeline/stages", async (context) => {
    try {
      const body = z
        .object({ name: z.string().trim().min(1).max(80) })
        .strict()
        .parse(await context.req.json())
      return context.json(
        repository.createPostStage({
          postId: context.req.param("id"),
          id: crypto.randomUUID(),
          name: body.name,
          createdAt: new Date().toISOString()
        }),
        201
      )
    } catch (error) {
      return failure(context, error)
    }
  })
  routes.patch("/postings/:id/pipeline/stages/:stageId", async (context) => {
    try {
      const body = z
        .object({ name: z.string().trim().min(1).max(80) })
        .strict()
        .parse(await context.req.json())
      repository.renamePostStage(context.req.param("id"), context.req.param("stageId"), body.name)
      return context.body(null, 204)
    } catch (error) {
      return failure(context, error)
    }
  })
  routes.put("/postings/:id/pipeline/stages/order", async (context) => {
    try {
      const body = z
        .object({ stageIds: z.array(Id).min(1) })
        .strict()
        .parse(await context.req.json())
      repository.reorderPostStages(context.req.param("id"), body.stageIds)
      return context.body(null, 204)
    } catch (error) {
      return failure(context, error)
    }
  })
  routes.delete("/postings/:id/pipeline/stages/:stageId", (context) => {
    try {
      repository.deletePostStage(context.req.param("id"), context.req.param("stageId"))
      return context.body(null, 204)
    } catch (error) {
      return failure(context, error)
    }
  })
  routes.get("/postings/:id/versions", (context) => {
    try {
      return context.json({ versions: repository.versions(context.req.param("id")) })
    } catch (error) {
      return failure(context, error)
    }
  })
  routes.post("/postings/:id/versions/manual", async (context) => {
    try {
      const body = z
        .object({ text: z.string().min(1).max(1_000_000) })
        .strict()
        .parse(await context.req.json())
      return context.json(await service.addManualVersion(context.req.param("id"), body.text), 201)
    } catch (error) {
      return failure(context, error)
    }
  })
  routes.post("/postings/:id/versions/url", async (context) => {
    try {
      const body = z
        .object({ url: PublicHttpUrlSchema })
        .strict()
        .parse(await context.req.json())
      return context.json(await service.addUrlVersion(context.req.param("id"), body.url), 201)
    } catch (error) {
      return failure(context, error)
    }
  })
  routes.post("/postings/:id/versions/file", async (context) => {
    try {
      const file = (await context.req.formData()).get("file")
      if (!(file instanceof File)) return context.json({ error: { code: "FILE_REQUIRED" } }, 400)
      return context.json(await service.addFileVersion(context.req.param("id"), file), 201)
    } catch (error) {
      return failure(context, error)
    }
  })
  routes.post("/postings/:id/archive", (context) => {
    try {
      repository.archivePost(context.req.param("id"), new Date().toISOString())
      return context.body(null, 204)
    } catch (error) {
      return failure(context, error)
    }
  })

  routes.get("/pipeline/stages", (context) => context.json({ stages: repository.stages() }))
  routes.post("/pipeline/stages", async (context) => {
    try {
      const body = z
        .object({
          key: z
            .string()
            .regex(/^[a-z][a-z0-9_]*$/)
            .max(64),
          name: z.string().trim().min(1).max(80)
        })
        .strict()
        .parse(await context.req.json())
      return context.json(
        repository.createStage({
          id: crypto.randomUUID(),
          ...body,
          createdAt: new Date().toISOString()
        }),
        201
      )
    } catch (error) {
      return failure(context, error)
    }
  })
  routes.patch("/pipeline/stages/:id", async (context) => {
    try {
      const body = z
        .object({ name: z.string().trim().min(1).max(80) })
        .strict()
        .parse(await context.req.json())
      repository.renameStage(context.req.param("id"), body.name)
      return context.body(null, 204)
    } catch (error) {
      return failure(context, error)
    }
  })
  routes.put("/pipeline/stages/order", async (context) => {
    try {
      const body = z
        .object({ stageIds: z.array(Id).min(1) })
        .strict()
        .parse(await context.req.json())
      repository.reorderStages(body.stageIds)
      return context.body(null, 204)
    } catch (error) {
      return failure(context, error)
    }
  })
  routes.delete("/pipeline/stages/:id", (context) => {
    try {
      repository.deleteStage(context.req.param("id"))
      return context.body(null, 204)
    } catch (error) {
      return failure(context, error)
    }
  })

  routes.get("/applications", (context) =>
    context.json({ applications: repository.applications() })
  )
  routes.post("/applications", async (context) => {
    try {
      const body = z
        .object({ jobPostId: Id, idempotencyKey: Id })
        .strict()
        .parse(await context.req.json())
      return context.json(
        repository.createApplication({
          id: crypto.randomUUID(),
          postId: body.jobPostId,
          idempotencyKey: body.idempotencyKey,
          createdAt: new Date().toISOString()
        }),
        201
      )
    } catch (error) {
      return failure(context, error)
    }
  })
  routes.post("/applications/:id/transition", async (context) => {
    try {
      const body = z
        .object({ stageId: Id })
        .strict()
        .parse(await context.req.json())
      return context.json(
        repository.transition({
          applicationId: context.req.param("id"),
          stageId: body.stageId,
          at: new Date().toISOString()
        })
      )
    } catch (error) {
      return failure(context, error)
    }
  })
  routes.post("/applications/:id/notes", async (context) => {
    try {
      const body = z
        .object({ text: z.string().trim().min(1).max(10_000) })
        .strict()
        .parse(await context.req.json())
      repository.addNote(context.req.param("id"), body.text, new Date().toISOString())
      return context.body(null, 204)
    } catch (error) {
      return failure(context, error)
    }
  })
  routes.get("/applications/:id/history", (context) => {
    try {
      return context.json({
        events: repository.events(context.req.param("id")),
        interviews: repository.interviews(context.req.param("id"))
      })
    } catch (error) {
      return failure(context, error)
    }
  })
  routes.post("/applications/:id/interviews", async (context) => {
    try {
      const body = z
        .object({
          scheduledAt: z.string().datetime(),
          endedAt: z.string().datetime().nullable().default(null),
          kind: z.string().trim().min(1).max(80),
          location: z.string().trim().max(500).nullable().default(null),
          notes: z.string().max(10_000).default("")
        })
        .strict()
        .parse(await context.req.json())
      repository.scheduleInterview({
        id: crypto.randomUUID(),
        applicationId: context.req.param("id"),
        ...body,
        createdAt: new Date().toISOString()
      })
      return context.body(null, 201)
    } catch (error) {
      return failure(context, error)
    }
  })
  routes.post("/applications/:id/archive", (context) => {
    try {
      repository.archiveApplication(context.req.param("id"), new Date().toISOString())
      return context.body(null, 204)
    } catch (error) {
      return failure(context, error)
    }
  })
  return routes
}
