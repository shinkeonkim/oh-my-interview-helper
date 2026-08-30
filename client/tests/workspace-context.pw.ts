import { expect, test } from "@playwright/test"

test("replaces interview, conversation, and research data when the job context changes", async ({
  page
}) => {
  const firstPostId = "11111111-1111-4111-8111-111111111111"
  const secondPostId = "22222222-2222-4222-8222-222222222222"
  const firstApplicationId = "33333333-3333-4333-8333-333333333333"
  const secondApplicationId = "44444444-4444-4444-8444-444444444444"
  const firstConversationId = "55555555-5555-4555-8555-555555555555"
  const researchQueries: string[] = []
  const posts = [
    {
      id: firstPostId,
      title: "First role",
      companyName: "First company",
      teamName: "First team",
      currentVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      versionNumber: 1
    },
    {
      id: secondPostId,
      title: "Second role",
      companyName: "Second company",
      teamName: "Second team",
      currentVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      versionNumber: 2
    }
  ]
  const applications = [
    {
      id: firstApplicationId,
      jobPostId: firstPostId,
      stageName: "Interviewing",
      appliedAt: null
    },
    {
      id: secondApplicationId,
      jobPostId: secondPostId,
      stageName: "Applied",
      appliedAt: null
    }
  ]

  await page.route("**/api/postings", (route) => route.fulfill({ json: { postings: posts } }))
  await page.route("**/api/applications", (route) => route.fulfill({ json: { applications } }))
  await page.route(/\/api\/applications\/[^/]+\/history$/, async (route) => {
    const first = route.request().url().includes(firstApplicationId)
    await route.fulfill({
      json: {
        events: [],
        interviews: [
          {
            id: first
              ? "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
              : "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            scheduledAt: "2026-09-01T03:00:00.000Z",
            kind: first ? "First interview" : "Second interview"
          }
        ]
      }
    })
  })
  await page.route("**/api/documents", (route) => route.fulfill({ json: { documents: [] } }))
  await page.route("**/api/providers/status", (route) => route.fulfill({ json: { providers: [] } }))
  await page.route(/\/api\/conversations\?applicationId=/, async (route) => {
    const applicationId = new URL(route.request().url()).searchParams.get("applicationId")
    await route.fulfill({
      json: {
        conversations:
          applicationId === firstApplicationId
            ? [{ id: firstConversationId, title: "First conversation" }]
            : []
      }
    })
  })
  await page.route(`**/api/conversations/${firstConversationId}/messages`, (route) =>
    route.fulfill({
      json: {
        messages: [
          {
            id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            role: "assistant",
            content: { answer: "First private conversation" }
          }
        ]
      }
    })
  )
  await page.route(/\/api\/research\?jobPostId=/, async (route) => {
    const requestedPostId = new URL(route.request().url()).searchParams.get("jobPostId") ?? ""
    researchQueries.push(requestedPostId)
    const first = requestedPostId === firstPostId
    await route.fulfill({
      json: {
        records: [
          {
            id: first
              ? "ffffffff-ffff-4fff-8fff-ffffffffffff"
              : "12121212-1212-4212-8212-121212121212",
            subjectType: "company",
            subjectName: first ? "First research" : "Second research",
            parentRecordId: null,
            identityStatus: "confirmed",
            createdAt: "2026-08-29T00:00:00.000Z"
          }
        ]
      }
    })
  })

  const changeRoute = async (path: string) => {
    await page.evaluate((nextPath) => {
      window.history.pushState({}, "", nextPath)
      window.dispatchEvent(new PopStateEvent("popstate"))
    }, path)
  }

  await page.goto(`/jobs/${firstPostId}/overview`)
  await expect(page.getByRole("heading", { name: "First role" })).toBeVisible()
  await expect(page.getByText("First interview", { exact: false })).toBeVisible()
  await expect(page.getByText("First private conversation")).toBeVisible()

  await changeRoute(`/jobs/${secondPostId}/overview`)
  await expect(page).toHaveURL(new RegExp(`/jobs/${secondPostId}/overview$`))
  await expect(page.getByRole("heading", { name: "Second role" })).toBeVisible()
  await expect(page.getByText("Second interview", { exact: false })).toBeVisible()
  await expect(page.getByText("First interview", { exact: false })).toHaveCount(0)
  await expect(page.getByText("First private conversation")).toHaveCount(0)
  await expect(page.getByText("아직 대화가 없습니다.")).toBeVisible()

  await page
    .getByRole("navigation", { name: "채용공고 워크스페이스" })
    .getByRole("link", { name: "기업 분석", exact: true })
    .click()
  await expect(page.getByText("Second research")).toBeVisible()

  await page
    .getByRole("navigation", { name: "채용공고 워크스페이스" })
    .getByRole("link", { name: "인물 & 팀 분석", exact: true })
    .click()
  await expect(page.getByRole("combobox")).toContainText("팀 리드")
  await expect(page.getByText("이름 또는 회사명").locator("..").getByRole("textbox")).toHaveValue(
    ""
  )
  await expect(page.getByText("소속 회사").locator("..").getByRole("textbox")).toHaveValue(
    "Second company"
  )

  await changeRoute(`/jobs/${firstPostId}/company`)
  await expect(page.getByRole("combobox")).toContainText("회사")
  await expect(page.getByText("First research")).toBeVisible()
  await expect(page.getByText("Second research")).toHaveCount(0)
  expect(researchQueries).toEqual(expect.arrayContaining([secondPostId, firstPostId]))
})
