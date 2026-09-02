import type { Database } from "bun:sqlite"
import { z } from "zod"

import type { DisclosureInputRef } from "../disclosures/sources"
import { DisclosureSourceError, DisclosureSourceResolver } from "../disclosures/sources"

const MAX_SOURCE_CHARACTERS = 40_000
const MAX_TOTAL_CHARACTERS = 120_000

export type WorkflowSourceContent = {
  readonly id: string
  readonly kind: DisclosureInputRef["kind"]
  readonly label: string
  readonly version: number | null
  readonly boundary: "untrusted_user_content" | "untrusted_public_web" | "untrusted_ai_draft"
  readonly text: string
}

export class WorkflowSourceContentResolver {
  private readonly disclosureSources: DisclosureSourceResolver
  constructor(private readonly database: Database) {
    this.disclosureSources = new DisclosureSourceResolver(database)
  }

  resolveAll(
    inputs: readonly DisclosureInputRef[],
    maximumTotalCharacters = MAX_TOTAL_CHARACTERS
  ): readonly WorkflowSourceContent[] {
    const perSourceCharacters = Math.min(
      MAX_SOURCE_CHARACTERS,
      Math.floor(maximumTotalCharacters / Math.max(inputs.length, 1))
    )
    return inputs.map((input) => {
      const metadata = this.disclosureSources.resolve(input)
      const source = this.resolve(input, metadata.label, metadata.version)
      return { ...source, text: source.text.slice(0, perSourceCharacters) }
    })
  }

  private resolve(
    input: DisclosureInputRef,
    label: string,
    version: number | null
  ): WorkflowSourceContent {
    switch (input.kind) {
      case "document_version": {
        const row = this.database
          .query<{ extractedText: string | null }, [string]>(
            "SELECT extracted_text extractedText FROM document_versions WHERE id=?"
          )
          .get(input.documentVersionId)
        if (row?.extractedText === null || row?.extractedText === undefined)
          throw new WorkflowSourceContentError("content_unavailable")
        return content(
          input.documentVersionId,
          input.kind,
          label,
          version,
          "untrusted_user_content",
          row.extractedText
        )
      }
      case "job_post_version": {
        const row = this.database
          .query<{ value: string }, [string]>(
            "SELECT structured_content value FROM job_post_versions WHERE id=?"
          )
          .get(input.jobPostVersionId)
        if (row === null) throw new WorkflowSourceContentError("content_unavailable")
        return content(
          input.jobPostVersionId,
          input.kind,
          label,
          version,
          "untrusted_user_content",
          row.value
        )
      }
      case "research_source": {
        const row = this.database
          .query<{ excerpt: string }, [string]>("SELECT excerpt FROM research_sources WHERE id=?")
          .get(input.researchSourceId)
        if (row === null) throw new WorkflowSourceContentError("content_unavailable")
        return content(
          input.researchSourceId,
          input.kind,
          label,
          version,
          "untrusted_public_web",
          row.excerpt
        )
      }
      case "artifact_revision": {
        const row = this.database
          .query<{ value: string }, [string]>(
            "SELECT content_json value FROM draft_artifact_revisions WHERE id=?"
          )
          .get(input.artifactRevisionId)
        if (row === null) throw new WorkflowSourceContentError("content_unavailable")
        return content(
          input.artifactRevisionId,
          input.kind,
          label,
          version,
          "untrusted_ai_draft",
          row.value
        )
      }
    }
  }
}

const content = (
  id: string,
  kind: DisclosureInputRef["kind"],
  label: string,
  version: number | null,
  boundary: WorkflowSourceContent["boundary"],
  raw: string
): WorkflowSourceContent => {
  const text = z.string().parse(raw).slice(0, MAX_SOURCE_CHARACTERS)
  if (text.trim().length === 0) throw new WorkflowSourceContentError("content_unavailable")
  return { id, kind, label, version, boundary, text }
}

export class WorkflowSourceContentError extends Error {
  override readonly name = "WorkflowSourceContentError"
  constructor(readonly code: "content_unavailable" | "input_too_large") {
    super(`WORKFLOW_SOURCE_${code.toUpperCase()}`)
  }
}

export { DisclosureSourceError }
