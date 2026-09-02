import { z } from "zod"

const PromptTemplateRevisionSchema = z
  .object({ id: z.string().trim().min(1), revision: z.string().trim().min(1) })
  .strict()

export type PromptTemplateRevision = z.output<typeof PromptTemplateRevisionSchema>

export class PromptTemplateRevisionRegistry {
  private readonly templates = new Map<string, PromptTemplateRevision>()

  constructor(templates: readonly PromptTemplateRevision[]) {
    for (const template of templates) {
      const parsed = PromptTemplateRevisionSchema.parse(template)
      if (this.templates.has(parsed.id)) throw new PromptTemplateRegistryError("duplicate")
      this.templates.set(parsed.id, parsed)
    }
  }

  get(id: string): PromptTemplateRevision | null {
    return this.templates.get(id) ?? null
  }
}

export class PromptTemplateRegistryError extends Error {
  override readonly name = "PromptTemplateRegistryError"

  constructor(readonly code: "duplicate") {
    super(code)
  }
}

export const defaultPromptTemplateRevisionRegistry = new PromptTemplateRevisionRegistry([
  { id: "cover-letter", revision: "cover-letter@1" },
  { id: "resume", revision: "resume@1" },
  { id: "interview-brief", revision: "interview-brief@1" },
  { id: "application-answer", revision: "application-answer@1" },
  { id: "resume-feedback", revision: "resume-feedback@1" },
  { id: "interview-prep", revision: "interview-prep@1" },
  { id: "technical-prep", revision: "technical-prep@1" },
  { id: "culture-interview", revision: "culture-interview@4" },
  { id: "topic-answers", revision: "topic-answers@1" },
  { id: "company-questions", revision: "company-questions@1" }
])
