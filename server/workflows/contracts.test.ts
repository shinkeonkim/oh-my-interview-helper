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
    expect(artifactKindForWorkflow("culture_interview")).toBe("interview_brief")
    expect(artifactKindForWorkflow("topic_answers")).toBe("application_answer")
    expect(promptTemplateForWorkflow("company_questions")).toBe("company-questions")
    expect(promptTemplateForWorkflow("culture_interview")).toBe("culture-interview")
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

  test("컬쳐 면접은 문화 분석과 예상 질문을 함께 요구한다", () => {
    const sourceId = "11111111-1111-4111-8111-111111111111"
    const citation = [{ sourceId, note: "공개 근거" }]
    expect(() =>
      parsePreparationOutput("culture_interview", {
        workflow: "culture_interview",
        title: "컬쳐 면접 준비",
        summary: "공식 정보와 후기성 정보를 구분한 준비 자료",
        sections: ["기업 문화", "인재상", "최근 면접 후기", "마음가짐"].map((heading) => ({
          heading,
          body: `${heading} 근거`,
          citations: citation
        })),
        questions: Array.from({ length: 5 }, (_, index) => ({
          question: `질문 ${index + 1}`,
          suggestedAnswer: "지원자 경험을 바탕으로 답변",
          rationale: "문화 적합성을 확인",
          citations: citation
        }))
      })
    ).not.toThrow()
  })
})
