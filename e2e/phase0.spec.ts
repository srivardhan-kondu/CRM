import { expect, test } from "@playwright/test";
import { openNav, primaryNav, signInAs } from "./helpers";

test("unauthenticated users are sent to sign in", async ({ page }) => {
  await page.goto("/students");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in to CampusOS" })).toBeVisible();
});

test("principal → institution dashboard with drill-down to the shortage list", async ({ page }) => {
  await signInAs(page, /Meera Raghavan/);
  // The first page of a freshly started server can take a few seconds while it warms up.
  await expect(page.getByRole("heading", { name: /Good morning, Meera/ })).toBeVisible({ timeout: 15_000 });
  await openNav(page);
  await expect(primaryNav(page).getByRole("link", { name: /Ask a question/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // The to-do list comes first; the students who can't sit exams are one click away.
  await expect(page.getByRole("heading", { name: "Your to-do list" })).toBeVisible();
  await page.getByRole("link", { name: "See students" }).first().click();
  await expect(page).toHaveURL(/shortage=1/);
  await expect(page.getByRole("tab", { name: "Attendance shortage", selected: true })).toBeVisible();
});

test("roles render different navigation", async ({ page }) => {
  const navFor = async (who: RegExp) => {
    await signInAs(page, who);
    await openNav(page);
    const items = await primaryNav(page).getByRole("link").allInnerTexts();
    await page.context().clearCookies();
    return items.map((t) => t.replace(/\s*(P\d+|\d+)$/, "").trim());
  };
  const principal = await navFor(/Meera Raghavan/);
  const incharge = await navFor(/Kavya Nair/);
  const student = await navFor(/Student · /);

  expect(principal).toEqual(expect.arrayContaining(["Ask a question", "Users & access", "Audit log"]));
  // Modules from later phases are not shown in the menu.
  expect(principal).not.toContain("Analytics");
  expect(incharge).toEqual(expect.arrayContaining(["Home", "Parent communication"]));
  expect(incharge).not.toContain("Analytics");
  expect(student).toEqual(expect.arrayContaining(["My profile", "Timetable"]));
  expect(student).not.toContain("Students");
});

test("HOD → find a department student → Student 360", async ({ page }) => {
  await signInAs(page, /Arvind Kulkarni/);
  await page.goto("/students");
  await page.getByRole("searchbox", { name: "Search students" }).fill("3-CSE-B");
  await expect(page).toHaveURL(/q=3-CSE-B/);
  await page.locator("tbody tr").first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: /Open Student 360/ }).click();
  await expect(page.getByRole("heading", { name: "Student 360" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Student record" })
    .getByRole("link", { name: "Attendance" })
    .click();
  await expect(page.getByText("Attendance by subject")).toBeVisible();
  // HOD has no finance permission: no fee figure in the record header.
  await expect(page.getByRole("term").filter({ hasText: /^Fees$/ })).toHaveCount(0);
});

test("class incharge cannot open a student from another section by URL", async ({ page, browser }) => {
  // Find a 3-CSE-C student id as the principal, then try it as the class incharge.
  const principal = await browser.newPage();
  await signInAs(principal, /Meera Raghavan/);
  const res = await principal.request.get("/api/search?q=3-CSE-C");
  const { students } = (await res.json()) as { students: { id: string }[] };
  await principal.close();

  await signInAs(page, /Kavya Nair/);
  await page.goto(`/students/${students[0]!.id}`);
  await expect(page.getByRole("heading", { name: "Student not found" })).toBeVisible();
});

test("student sees only their own notices and profile", async ({ page }) => {
  await signInAs(page, /Student · /);
  await page.goto("/announcements?view=all");
  await expect(page.getByText(/heavy rainfall advisory/).first()).toBeVisible();
  await expect(page.getByText("ECE Internal Assessment II")).toHaveCount(0);
  await expect(page.getByText(/Faculty: daily attendance/)).toHaveCount(0);

  await page.goto("/students");
  await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "My profile" })).toBeVisible();
});

test("command palette opens with keyboard and navigates", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard shortcut is a desktop affordance");
  await signInAs(page, /Meera Raghavan/);
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog");
  await expect(palette).toBeVisible();
  await palette.getByRole("combobox").fill("announce");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/announcements/);
});

test("modules from later phases say so honestly", async ({ page }) => {
  await signInAs(page, /Meera Raghavan/);
  await page.goto("/mentoring");
  await expect(page.getByText(/Planned for Phase 6/)).toBeVisible();
});
