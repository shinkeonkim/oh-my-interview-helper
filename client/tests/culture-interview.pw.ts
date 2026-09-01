import { expect, test } from "@playwright/test"

test("기업 문화 조사 결과를 근거로 컬쳐 면접 준비 자료를 생성한다", async ({ page }) => {
  test.setTimeout(20_000)
  const postId = "11111111-1111-4111-8111-111111111111"
  const postVersionId = "22222222-2222-4222-8222-222222222222"
  const researchId = "33333333-3333-4333-8333-333333333333"
  const sourceId = "44444444-4444-4444-8444-444444444444"
  const researchTaskId = "55555555-5555-4555-8555-555555555555"
  const preparationTaskId = "66666666-6666-4666-8666-666666666666"
  const revisionId = "77777777-7777-4777-8777-777777777777"
  let researchCreated = false
  let previewBody: { workflow?: string; inputs?: Array<Record<string, string>> } = {}

  await page.route("**/api/security/csrf", (route) =>
    route.fulfill({ json: { csrfToken: "culture-token" } })
  )
  await page.route("**/api/postings", (route) =>
    route.fulfill({
      json: {
        postings: [
          {
            id: postId,
            title: "Platform Engineer",
            companyName: "Acme",
            teamName: "Core",
            currentVersionId: postVersionId,
            versionNumber: 1
          }
        ]
      }
    })
  )
  await page.route("**/api/applications", (route) => route.fulfill({ json: { applications: [] } }))
  await page.route("**/api/documents", (route) => route.fulfill({ json: { documents: [] } }))
  await page.route("**/api/providers/status", (route) =>
    route.fulfill({
      json: {
        providers: [
          {
            id: "codex-cli",
            configured: true,
            model: { id: "gpt-5.4", displayName: "gpt-5.4" }
          }
        ]
      }
    })
  )
  await page.route(/\/api\/research\?jobPostId=/, (route) =>
    route.fulfill({
      json: {
        records: researchCreated
          ? [
              {
                id: researchId,
                subjectType: "company",
                subjectName: "Acme",
                parentRecordId: null,
                identityStatus: "confirmed",
                createdAt: "2026-09-01T00:00:00.000Z"
              }
            ]
          : []
      }
    })
  )
  await page.route(`**/api/research/${researchId}`, (route) =>
    route.fulfill({
      json: {
        id: researchId,
        subjectType: "company",
        subjectName: "Acme",
        parentRecordId: null,
        identityStatus: "confirmed",
        identityCandidates: [],
        createdAt: "2026-09-01T00:00:00.000Z",
        analysis: {
          summary: { career: ["고객 중심"], stack: [], projects: ["자율적인 협업"] },
          fitAssessment: { label: "advisory", summary: "근거 기반 조언", strengths: [], risks: [] }
        },
        claims: [
          {
            id: "claim-1",
            statement: "공식 핵심 가치는 고객 중심이다.",
            classification: "fact",
            sourceIds: [sourceId],
            confidence: "high"
          }
        ],
        sources: [
          {
            id: sourceId,
            title: "Acme Culture",
            url: "https://example.com/culture",
            excerpt: "Acme culture and interview principles",
            status: "available",
            retrievedAt: "2026-09-01T00:00:00.000Z"
          }
        ]
      }
    })
  )
  await page.route("**/api/jobs", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: [] })
    const body = route.request().postDataJSON() as { kind: string }
    if (body.kind === "ui.research") {
      researchCreated = true
      return route.fulfill({ status: 201, json: { id: researchTaskId, state: "queued" } })
    }
    return route.fulfill({ status: 201, json: { id: preparationTaskId, state: "queued" } })
  })
  await page.route(`**/api/jobs/${researchTaskId}`, (route) =>
    route.fulfill({ json: { id: researchTaskId, state: "succeeded" } })
  )
  await page.route(`**/api/jobs/${researchTaskId}/events?transport=poll`, (route) =>
    route.fulfill({
      json: { events: [{ kind: "progress", payload: { phase: "result", recordId: researchId } }] }
    })
  )
  await page.route(`**/api/jobs/${preparationTaskId}`, (route) =>
    route.fulfill({ json: { id: preparationTaskId, state: "succeeded" } })
  )
  await page.route(`**/api/jobs/${preparationTaskId}/events?transport=poll`, (route) =>
    route.fulfill({
      json: { events: [{ kind: "progress", payload: { phase: "result", revisionId } }] }
    })
  )
  await page.route("**/api/workflows/preview", async (route) => {
    previewBody = route.request().postDataJSON()
    await route.fulfill({
      json: {
        authorizationToken: "signed-culture-token",
        manifest: {
          destination: "codex-cli",
          model: "gpt-5.4",
          action: "prepare:culture_interview",
          inputs: []
        }
      }
    })
  })
  await page.route("**/api/disclosures/confirm", (route) =>
    route.fulfill({ status: 201, json: { id: "88888888-8888-4888-8888-888888888888" } })
  )
  await page.route(`**/api/artifacts/revisions/${revisionId}`, (route) =>
    route.fulfill({
      json: {
        id: revisionId,
        seriesId: "99999999-9999-4999-8999-999999999999",
        number: 1,
        providerId: "codex-cli",
        providerModel: "gpt-5.4",
        content: {
          workflow: "culture_interview",
          title: "Acme 컬쳐 면접 준비",
          summary: "공식 문화와 후기성 정보를 구분해 준비합니다.",
          sections: [
            { heading: "기업 문화", body: "고객 중심", citations: [] },
            { heading: "인재상", body: "주도적인 협업", citations: [] },
            { heading: "최근 면접 후기", body: "개인 경험담으로 참고", citations: [] },
            { heading: "마음가짐", body: "솔직한 경험 근거", citations: [] }
          ],
          questions: [
            {
              question: "협업 갈등을 해결한 경험은?",
              suggestedAnswer: "실제 경험을 STAR로 답합니다.",
              rationale: "협업 방식을 확인합니다.",
              citations: []
            }
          ]
        }
      }
    })
  )
  await page.route(`**/api/artifacts/revisions/${revisionId}/provenance`, (route) =>
    route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } })
  )

  await page.goto(`/jobs/${postId}/culture`)
  await expect(page.getByText("컬쳐 면접 준비 센터")).toBeVisible()
  await expect(page.getByLabel("역할 단서")).toHaveValue(/기업 문화.*최근 공개 면접 후기/)
  await page.getByRole("button", { name: "리서치 시작" }).click()
  await expect(page.getByRole("link", { name: "Acme Culture" })).toBeVisible()
  await expect(page.getByText("최신 기업 리서치 출처 1개")).toBeVisible()

  await page.getByRole("button", { name: "전송 내용 확인" }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  expect(previewBody.workflow).toBe("culture_interview")
  expect(previewBody.inputs).toContainEqual({ kind: "research_source", researchSourceId: sourceId })
  await page.getByRole("dialog").getByRole("button", { name: "확인하고 생성" }).click()
  await expect(page.getByRole("heading", { name: "Acme 컬쳐 면접 준비" })).toBeVisible()
  await expect(page.getByText("개인 경험담으로 참고")).toBeVisible()
  await expect(page.getByText("협업 갈등을 해결한 경험은?")).toBeVisible()
})
