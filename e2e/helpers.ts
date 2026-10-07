import type { Page } from "@playwright/test";

/** Sign in through the real Better Auth flow as a seeded synthetic persona. */
export async function signInAs(page: Page, name: RegExp | string) {
  await page.goto("/login");
  await page.getByRole("radiogroup").locator("label", { hasText: name }).click();
  await page.getByRole("button", { name: "Continue as demo user" }).click();
  await page.waitForURL("**/dashboard");
}

export function primaryNav(page: Page) {
  return page.getByRole("navigation", { name: "Primary" });
}

/** On mobile the navigation lives in a drawer. */
export async function openNav(page: Page) {
  const toggle = page.getByRole("button", { name: "Open menu" });
  if (await toggle.isVisible()) await toggle.click();
}
