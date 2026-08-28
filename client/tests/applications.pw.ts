import { expect, test } from "@playwright/test"

test("creates a posting and moves an application through the local pipeline", async ({ page }) => {
  const post = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Backend Engineer",
    companyName: "Acme",
    teamName: "Platform",
    state: "active",
    versionNumber: 1,
    sourceKind: "manual"
  }
  const stages = [
    {
      id: "00000000-0000-4000-8000-000000000001",
      key: "saved",
      name: "Saved",
      position: 1,
      outcome: null
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      key: "applied",
      name: "Applied",
      position: 2,
      outcome: null
    },
    {
      id: "00000000-0000-4000-8000-000000000003",
      key: "interviewing",
      name: "Interviewing",
      position: 3,
      outcome: null
    }
  ]
  const savedStage = stages[0]
  const interviewingStage = stages[2]
  if (savedStage === undefined || interviewingStage === undefined) throw new Error("stages missing")
  let postings: (typeof post)[] = []
  let applications: Array<{
    id: string
    jobPostId: string
    stageId: string
    stageName: string
    appliedAt: string | null
    outcomeAt: string | null
    archivedAt: null
  }> = []
  await page.route("**/api/security/csrf", (route) =>
    route.fulfill({ json: { csrfToken: "token" } })
  )
  await page.route("**/api/postings", (route) => route.fulfill({ json: { postings } }))
  await page.route("**/api/pipeline/stages", (route) => route.fulfill({ json: { stages } }))
  await page.route("**/api/postings/manual", async (route) => {
    postings = [post]
    await route.fulfill({ status: 201, json: post })
  })
  await page.route("**/api/applications", async (route) => {
    if (route.request().method() === "POST")
      applications = [
        {
          id: "22222222-2222-4222-8222-222222222222",
          jobPostId: post.id,
          stageId: savedStage.id,
          stageName: "Saved",
          appliedAt: null,
          outcomeAt: null,
          archivedAt: null
        }
      ]
    await route.fulfill({
      status: route.request().method() === "POST" ? 201 : 200,
      json: route.request().method() === "POST" ? applications[0] : { applications }
    })
  })
  await page.route("**/api/applications/*/transition", async (route) => {
    const current = applications[0]
    if (current === undefined) throw new Error("application missing")
    applications[0] = { ...current, stageId: interviewingStage.id, stageName: "Interviewing" }
    await route.fulfill({ json: applications[0] })
  })
  await page.route("**/api/applications/*/history", (route) =>
    route.fulfill({
      json: {
        events: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            sequence: 1,
            kind: "created",
            payload: {},
            createdAt: "2026-08-28T00:00:00.000Z"
          }
        ],
        interviews: []
      }
    })
  )

  await page.goto("/jobs")
  await page.getByText("직무명").locator("..").getByRole("textbox").fill(post.title)
  await page
    .getByText("회사", { exact: true })
    .locator("..")
    .getByRole("textbox")
    .fill(post.companyName)
  await page.getByText("팀", { exact: true }).locator("..").getByRole("textbox").fill(post.teamName)
  await page.getByPlaceholder("공고 내용").fill("Role body")
  await page.getByRole("button", { name: "공고 저장" }).click()
  await expect(page.getByText(post.title)).toBeVisible()
  await page.getByRole("button", { name: "지원 시작" }).click()
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible()
  await page.getByRole("combobox").last().click()
  await page.getByRole("option", { name: "Interviewing" }).click()
  await page.getByRole("button", { name: "단계 이동" }).click()
  await expect(page.getByText("Interviewing", { exact: true }).first()).toBeVisible()
  await page.getByRole("button", { name: "전체 이력" }).click()
  await expect(page.getByText(/#1 created/)).toBeVisible()
})
