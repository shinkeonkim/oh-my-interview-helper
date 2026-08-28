import { Hono, type Context } from "hono"
import { z } from "zod"

import { DocumentKindSchema, DocumentLibraryError } from "../documents/repository"
import { DocumentServiceError, type DocumentLibraryService } from "../documents/service"
import { IngestionError } from "../ingest/file-preview"
import { safeErrorCode } from "../security/redaction"

const ManualSchema = z
  .object({
    kind: DocumentKindSchema,
    title: z.string().trim().min(1).max(200),
    text: z.string().min(1).max(1_000_000)
  })
  .strict()

const error = (context: Context, value: unknown) => {
  if (value instanceof IngestionError)
    return context.json(
      safeErrorCode(value, value.code),
      value.code === "FILE_TOO_LARGE" ? 413 : 422
    )
  if (value instanceof DocumentServiceError || value instanceof DocumentLibraryError)
    return context.json(
      safeErrorCode(value, value.code.toUpperCase()),
      value.code === "not_found" ? 404 : 409
    )
  return context.json(safeErrorCode(value, "DOCUMENT_OPERATION_FAILED"), 400)
}

export const createDocumentRoutes = (documents: DocumentLibraryService): Hono => {
  const routes = new Hono()
  routes.get("/", (context) => context.json({ documents: documents.list() }))
  routes.get("/context", (context) => context.json({ documents: documents.selectedContext() }))
  routes.post("/upload", async (context) => {
    try {
      const form = await context.req.formData()
      const files = form.getAll("files").filter((value): value is File => value instanceof File)
      const kind = DocumentKindSchema.parse(form.get("kind"))
      if (files.length === 0) return context.json({ error: { code: "FILE_REQUIRED" } }, 400)
      const uploaded = []
      for (const file of files) uploaded.push(await documents.upload({ file, kind }))
      return context.json({ documents: uploaded }, 201)
    } catch (value) {
      return error(context, value)
    }
  })
  routes.post("/manual", async (context) => {
    try {
      return context.json(await documents.manual(ManualSchema.parse(await context.req.json())), 201)
    } catch (value) {
      return error(context, value)
    }
  })
  routes.get("/:id", (context) => {
    const document = documents.get(context.req.param("id"))
    return document === null
      ? context.json({ error: { code: "NOT_FOUND" } }, 404)
      : context.json(document)
  })
  routes.get("/:id/versions", (context) => {
    try {
      return context.json({ versions: documents.versions(context.req.param("id")) })
    } catch (value) {
      return error(context, value)
    }
  })
  routes.post("/:id/versions", async (context) => {
    try {
      const current = documents.get(context.req.param("id"))
      if (current === null) return context.json({ error: { code: "NOT_FOUND" } }, 404)
      const form = await context.req.formData()
      const file = form.get("file")
      if (!(file instanceof File)) return context.json({ error: { code: "FILE_REQUIRED" } }, 400)
      return context.json(
        await documents.upload({ file, kind: current.kind, documentId: current.id }),
        201
      )
    } catch (value) {
      return error(context, value)
    }
  })
  routes.get("/:id/preview", (context) => {
    try {
      return context.json(documents.preview(context.req.param("id")))
    } catch (value) {
      return error(context, value)
    }
  })
  routes.get("/:id/download", (context) => {
    try {
      const download = documents.download(context.req.param("id"))
      return new Response(download.file, {
        headers: {
          "Content-Type": download.mediaType,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(download.name)}`,
          "X-Content-Type-Options": "nosniff"
        }
      })
    } catch (value) {
      return error(context, value)
    }
  })
  routes.put("/:id/selection", (context) => {
    try {
      documents.repository.select(context.req.param("id"), true, new Date().toISOString())
      return context.body(null, 204)
    } catch (value) {
      return error(context, value)
    }
  })
  routes.delete("/:id/selection", (context) => {
    try {
      documents.repository.select(context.req.param("id"), false, new Date().toISOString())
      return context.body(null, 204)
    } catch (value) {
      return error(context, value)
    }
  })
  for (const [path, state] of [
    ["archive", "archived"],
    ["delete", "deleted"]
  ] as const)
    routes.post(`/:id/${path}`, (context) => {
      try {
        documents.repository.transition(context.req.param("id"), state, new Date().toISOString())
        return context.body(null, 204)
      } catch (value) {
        return error(context, value)
      }
    })
  return routes
}
