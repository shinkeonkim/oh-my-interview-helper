import { expect, test } from "bun:test"

import { sanitizeGeneratedCitations } from "../src/workflows/strands-executor"

test("로컬 모델이 만든 출처 ID 중 승인된 근거만 보존한다", () => {
  const allowed = "11111111-1111-4111-8111-111111111111"
  const forged = "22222222-2222-4222-8222-222222222222"

  expect(
    sanitizeGeneratedCitations(
      {
        questions: [
          {
            citations: [
              { sourceId: allowed, note: "확인됨" },
              { sourceId: forged, note: "잘못 생성됨" }
            ]
          }
        ]
      },
      new Set([allowed])
    )
  ).toEqual({ questions: [{ citations: [{ sourceId: allowed, note: "확인됨" }] }] })
})
