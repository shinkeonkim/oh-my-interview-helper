import { Hono } from "hono"

import type { LocalSecuritySettings } from "../security/config"
import { IngestionError, previewFile } from "../ingest/file-preview"
import {
  FetchBoundaryError,
  fetchPublicText,
  type PinnedTransport,
  type Resolver
} from "../ingest/safe-fetcher"
import { safeErrorCode } from "../security/redaction"
import { PublicHttpUrlSchema } from "../security/public-url"

export type PreviewRouteDependencies = {
  readonly dataDirectory: string
  readonly limits: LocalSecuritySettings
  readonly resolver?: Resolver | undefined
  readonly transport?: PinnedTransport | undefined
}

const statusForIngestionError = (error: IngestionError): 413 | 422 =>
  error.code === "FILE_TOO_LARGE" ? 413 : 422

const readUrl = async (request: Request): Promise<string | undefined> => {
  try {
    const payload: unknown = await request.json()
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("url" in payload) ||
      typeof payload.url !== "string"
    )
      return undefined
    return PublicHttpUrlSchema.safeParse(payload.url).data
  } catch {
    return undefined
  }
}

export const createPreviewRoutes = ({
  dataDirectory,
  limits,
  resolver,
  transport
}: PreviewRouteDependencies): Hono => {
  const app = new Hono()

  app.post("/file", async (context) => {
    const form = await context.req.formData()
    const file = form.get("file")
    if (!(file instanceof File)) return context.json(safeErrorCode(undefined, "FILE_REQUIRED"), 400)
    try {
      return context.json(await previewFile({ dataDirectory, file, limits }))
    } catch (error) {
      if (error instanceof IngestionError)
        return context.json(safeErrorCode(error, error.code), statusForIngestionError(error))
      return context.json(safeErrorCode(error, "EXTRACTION_FAILED"), 422)
    }
  })

  app.post("/url", async (context) => {
    const url = await readUrl(context.req.raw)
    if (url === undefined) return context.json(safeErrorCode(undefined, "URL_REQUIRED"), 400)
    try {
      return context.json(await fetchPublicText({ limits, resolver, transport, url }))
    } catch (error) {
      if (error instanceof FetchBoundaryError)
        return context.json(
          safeErrorCode(error, error.code),
          error.code === "FETCH_TOO_LARGE" ? 413 : 422
        )
      return context.json(safeErrorCode(error, "FETCH_FAILED"), 422)
    }
  })

  return app
}
