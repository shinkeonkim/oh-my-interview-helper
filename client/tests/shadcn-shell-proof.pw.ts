import { expect, test } from "@playwright/test"

test("shell exposes a project-owned sidebar primitive", async ({ page }) => {
  await page.goto("/")
  await expect(page.locator('[data-shell-primitive="sidebar"]')).toBeVisible()
})
