import { describe, expect, test } from "bun:test"

import {
  artifactKindForWorkflow,
  citationSourceIds,
  parsePreparationOutput,
  promptTemplateForWorkflow
} from "../src/workflows/contracts"

describe("preparation workflow contracts", () => {
  test("maps every detailed workflow to an immutable artifact family and prompt", () => {
    expect(artifactKindForWorkflow("cover_letter")).toBe("cover_letter")
    expect(artifactKindForWorkflow("resume_feedback")).toBe("resume")
    expect(artifactKindForWorkflow("technical_prep")).toBe("interview_brief")
    expect(artifactKindForWorkflow("topic_answers")).toBe("application_answer")
    expect(promptTemplateForWorkflow("company_questions")).toBe("company-questions")
  })

  test("requires structured content and extracts unique citations", () => {
    const sourceId = "11111111-1111-4111-8111-111111111111"
    const output = parsePreparationOutput("interview_prep", {
      workflow: "interview_prep",
      title: "면접 준비",
      summary: "근거 기반 질문",
      questions: [
        {
          question: "어떤 경험이 있나요?",
          suggestedAnswer: "프로젝트 경험을 설명합니다.",
          rationale: "직무 연관성을 확인합니다.",
          citations: [
            { sourceId, note: "공고 근거" },
            { sourceId, note: "같은 근거" }
          ]
        }
      ]
    })
    expect(citationSourceIds(output)).toEqual([sourceId])
    expect(() => parsePreparationOutput("technical_prep", output)).toThrow()
    expect(() =>
      parsePreparationOutput("cover_letter", {
        workflow: "cover_letter",
        title: "제목",
        summary: "요약",
        sections: []
      })
    ).toThrow()
  })
})
