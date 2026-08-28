import { z } from "zod"

import { DisclosureInputRefSchema } from "../disclosures/sources"

export const PreparationWorkflowKindSchema = z.enum([
  "cover_letter",
  "resume_feedback",
  "interview_prep",
  "technical_prep",
  "topic_answers",
  "company_questions"
])
export type PreparationWorkflowKind = z.output<typeof PreparationWorkflowKindSchema>

const CitationSchema = z
  .object({ sourceId: z.string().uuid(), note: z.string().trim().min(1).max(500) })
  .strict()
const SectionSchema = z
  .object({
    heading: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(10_000),
    citations: z.array(CitationSchema).max(20)
  })
  .strict()
const QuestionSchema = z
  .object({
    question: z.string().trim().min(1).max(2_000),
    suggestedAnswer: z.string().trim().min(1).max(10_000),
    rationale: z.string().trim().min(1).max(2_000),
    citations: z.array(CitationSchema).max(20)
  })
  .strict()

const BaseOutputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().min(1).max(4_000)
})
const SectionOutputSchema = BaseOutputSchema.extend({
  sections: z.array(SectionSchema).min(1).max(30)
})
const QuestionOutputSchema = BaseOutputSchema.extend({
  questions: z.array(QuestionSchema).min(1).max(50)
})

export const PreparationOutputSchemas = {
  cover_letter: SectionOutputSchema.extend({ workflow: z.literal("cover_letter") }).strict(),
  resume_feedback: SectionOutputSchema.extend({ workflow: z.literal("resume_feedback") }).strict(),
  interview_prep: QuestionOutputSchema.extend({ workflow: z.literal("interview_prep") }).strict(),
  technical_prep: QuestionOutputSchema.extend({ workflow: z.literal("technical_prep") }).strict(),
  topic_answers: QuestionOutputSchema.extend({ workflow: z.literal("topic_answers") }).strict(),
  company_questions: QuestionOutputSchema.extend({
    workflow: z.literal("company_questions")
  }).strict()
} satisfies Record<PreparationWorkflowKind, z.ZodType>

export const PreparationRequestSchema = z
  .object({
    workflow: PreparationWorkflowKindSchema,
    providerId: z.string().trim().min(1).max(64),
    disclosureId: z.string().uuid(),
    generationKey: z.string().uuid(),
    seriesId: z.string().uuid().nullable().default(null),
    inputs: z.array(DisclosureInputRefSchema).min(1).max(30),
    practiceAnswer: z.string().trim().min(1).max(20_000).nullable().default(null)
  })
  .strict()
export const PreparationDisclosureRequestSchema = PreparationRequestSchema.omit({
  disclosureId: true
}).strict()

export const artifactKindForWorkflow = (
  workflow: PreparationWorkflowKind
): "cover_letter" | "resume" | "interview_brief" | "application_answer" => {
  switch (workflow) {
    case "cover_letter":
      return "cover_letter"
    case "resume_feedback":
      return "resume"
    case "interview_prep":
    case "technical_prep":
    case "company_questions":
      return "interview_brief"
    case "topic_answers":
      return "application_answer"
  }
}

export const promptTemplateForWorkflow = (workflow: PreparationWorkflowKind): string =>
  workflow.replaceAll("_", "-")

export const parsePreparationOutput = (workflow: PreparationWorkflowKind, output: unknown) =>
  PreparationOutputSchemas[workflow].parse(output)

export const citationSourceIds = (output: unknown): readonly string[] => {
  const value = z
    .object({
      sections: z.array(SectionSchema).optional(),
      questions: z.array(QuestionSchema).optional()
    })
    .passthrough()
    .parse(output)
  return [
    ...new Set(
      [...(value.sections ?? []), ...(value.questions ?? [])].flatMap((item) =>
        item.citations.map((citation) => citation.sourceId)
      )
    )
  ]
}
