import { expect, test } from "@playwright/test"

const requiredRoutes = [
  ["홈", "/"],
  ["통합 검색", "/search"],
  ["채용 공고", "/jobs"],
  ["문서 보관함", "/documents"],
  ["채용 탐색", "/job-search"],
  ["통계", "/stats"],
  ["설정", "/settings"]
] as const

test.describe("application shell contract", () => {
  test.setTimeout(20_000)
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/**", (route) =>
      route.fulfill({
        json: { applications: [], documents: [], postings: [], records: [], stages: [] }
      })
    )
  })
  test("shows every required destination and Korean as the default locale", async ({ page }) => {
    await page.goto("/")

    const navigation = page.getByRole("navigation", { name: "주요 메뉴" })
    await expect(page).toHaveTitle(/Interview Helper/)
    await expect(page.locator("html")).toHaveAttribute("lang", "ko")
    await expect(page.locator('[data-shell-primitive="sidebar"]')).toBeVisible()
    for (const [label, href] of requiredRoutes) {
      await expect(navigation.getByRole("link", { name: new RegExp(label) })).toHaveAttribute(
        "href",
        href
      )
    }
    await expect(page.locator("#main-content")).toBeVisible()
    for (const locator of [
      page.locator("body"),
      page.locator("h1"),
      page.getByRole("button").first()
    ])
      await expect(locator).toHaveCSS("font-family", /Pretendard/)
  })

  test("opens Command search, navigates, and restores focus after Escape", async ({ page }) => {
    await page.goto("/")
    const searchButton = page.getByRole("button", { name: "검색 열기" })

    await searchButton.click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await expect(page.getByRole("dialog").getByRole("textbox")).toBeFocused()
    await page.getByRole("dialog").getByRole("textbox").fill("설정")
    await page.getByRole("dialog").getByRole("option", { name: /설정/ }).click()
    await expect(page).toHaveURL(/\/settings$/)

    await page.goto("/")
    await searchButton.click()
    await page.keyboard.press("Escape")
    await expect(searchButton).toBeFocused()
  })

  test("collapses the desktop sidebar to an icon rail and restores its width", async ({ page }) => {
    await page.context().clearCookies()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/")

    const sidebar = page.locator('[data-slot="sidebar"]')
    const sidebarTrigger = page.getByRole("button", { name: "사이드바 전환" })
    const sidebarWidth = async (): Promise<number> =>
      sidebar.evaluate((element) => element.getBoundingClientRect().width)

    await expect(sidebar).toHaveAttribute("data-state", "expanded")
    await expect.poll(sidebarWidth).toBeGreaterThanOrEqual(270)
    await expect.poll(sidebarWidth).toBeLessThanOrEqual(274)
    await expect(page.getByText("LOCAL / 01")).toBeVisible()
    await page.screenshot({
      path: ".omo/evidence/task-2-interview-helper/sidebar-fix/desktop-expanded.png",
      fullPage: true
    })

    await sidebarTrigger.click()
    await expect(sidebar).toHaveAttribute("data-state", "collapsed")
    await expect(sidebar).toHaveAttribute("data-collapsible", "icon")
    await expect.poll(sidebarWidth).toBeGreaterThanOrEqual(46)
    await expect.poll(sidebarWidth).toBeLessThanOrEqual(50)
    const firstMenuButton = sidebar.getByRole("link").first()
    await expect
      .poll(async () => {
        const sidebarBox = await sidebar.boundingBox()
        const buttonBox = await firstMenuButton.boundingBox()
        if (!sidebarBox || !buttonBox) return Number.POSITIVE_INFINITY
        return Math.abs(sidebarBox.x + sidebarBox.width / 2 - (buttonBox.x + buttonBox.width / 2))
      })
      .toBeLessThanOrEqual(1)
    await expect(page.getByText("LOCAL / 01")).toBeHidden()
    const homeIcon = sidebar.getByRole("navigation").getByRole("link").first()
    await homeIcon.hover()
    const tooltipContent = page.locator('[data-slot="tooltip-content"][role="tooltip"]')
    await expect(tooltipContent).toBeVisible()
    await expect(tooltipContent).toContainText("홈")
    await page.screenshot({
      path: ".omo/evidence/task-2-interview-helper/sidebar-tooltip-fix/desktop-collapsed-tooltip.png",
      fullPage: true
    })
    await page.mouse.move(1200, 500)
    await expect(tooltipContent).toBeHidden()
    await page.screenshot({
      path: ".omo/evidence/task-2-interview-helper/sidebar-fix/desktop-collapsed.png",
      fullPage: true
    })

    await sidebarTrigger.click()
    await expect(sidebar).toHaveAttribute("data-state", "expanded")
    await expect.poll(sidebarWidth).toBeGreaterThanOrEqual(270)
    await expect.poll(sidebarWidth).toBeLessThanOrEqual(274)
    await expect(sidebarTrigger).toBeFocused()
  })

  test("persists locale and all theme modes, including system recovery", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("button", { name: "언어를 English로 변경" }).click()
    await page.getByRole("button", { name: "Choose theme" }).click()
    await page.getByRole("menuitem", { name: "Dark" }).click()
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem("interview-helper.locale")))
      .toBe("en")
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem("interview-helper.theme")))
      .toBe("dark")

    await page.getByRole("button", { name: "Choose theme" }).click()
    await page.getByRole("menuitem", { name: "System" }).click()
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light")

    await page.evaluate(() => {
      window.localStorage.setItem("interview-helper.locale", "invalid-locale")
      window.localStorage.setItem("interview-helper.theme", "invalid-theme")
    })
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem("interview-helper.locale")))
      .toBe("invalid-locale")
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem("interview-helper.theme")))
      .toBe("invalid-theme")
  })

  test("uses Sheet on mobile, traps focus, restores trigger, and has no 320px overflow", async ({
    page
  }) => {
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto("/")
    const menuButton = page.getByRole("button", { name: "메뉴 열기" })
    await menuButton.click()
    const sheet = page.locator('[data-shell-primitive="sheet"]')
    await expect(sheet).toBeVisible()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await page.keyboard.press("Tab")
    await expect
      .poll(async () => dialog.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true)
    await page.keyboard.press("Escape")
    await expect(menuButton).toBeFocused()
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      )
      .toBe(true)

    await page.emulateMedia({ reducedMotion: "reduce" })
    await expect(page.locator("html")).toHaveCSS("scroll-behavior", "auto")
    await page.screenshot({
      path: ".omo/evidence/task-2-interview-helper/sidebar-fix/mobile-320.png",
      fullPage: true
    })
  })

  test("renders every route and an honest unknown-route fallback", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/")
    const navigation = page.getByRole("navigation", { name: "주요 메뉴" })
    for (const [label, route] of requiredRoutes) {
      if (route !== "/") {
        await navigation.getByRole("link", { name: new RegExp(label) }).click()
        await expect(page).toHaveURL(new RegExp(`${route.replace("/", "\\/")}$`))
      }
      await expect(page.locator("#main-content")).toBeVisible()
      await expect(page.locator("h1")).toBeVisible()
    }
    await page.goto("/route-that-does-not-exist", { waitUntil: "domcontentloaded" })
    await expect(page.locator("#main-content")).toContainText(
      /공간은 아직 없습니다|space is not available/
    )
  })
})
