import { expect, test } from "@playwright/test";
import { signInAs } from "./helpers";

/*
 * The redesigned operating system: role homes built on the attention model, Ask CampusOS, natural-language search,
 * scheduled and role-targeted notices, and the tabbed Student 360.
 */

test("the principal sees campus health and what needs attention first", async ({ page }) => {
  await signInAs(page, /Meera Raghavan/);
  await expect(page.getByRole("heading", { name: /Campus health/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Needs attention", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Attendance, week by week" })).toBeVisible();
  await expect(page.getByText("Phase 8").first()).toBeVisible();
  await page.getByLabel("Dashboard scope").selectOption({ label: "Computer Science & Engineering" });
  await expect(page).toHaveURL(/scope=CSE/);
  await expect(page.getByRole("heading", { name: /Department health/ })).toBeVisible();
});

test("each role lands on a home built for it", async ({ page, browser }) => {
  await signInAs(page, /Kavya Nair/);
  await expect(page.getByRole("heading", { name: /Class health/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Today's timetable" })).toBeVisible();

  const student = await browser.newPage();
  await signInAs(student, /Student · /);
  await expect(student.getByRole("heading", { name: "My day" })).toBeVisible();
  await expect(student.getByRole("heading", { name: "Upcoming exams" })).toBeVisible();
  await student.close();
});

test("Ask CampusOS answers from the asker's own scope, with records and sources", async ({ page }) => {
  await signInAs(page, /Kavya Nair/);
  await page.goto("/insights");
  await page.getByLabel("Ask CampusOS").fill("students below 80% attendance");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/students? of 14 in your scope/)).toBeVisible();
  await expect(page.getByText("Supporting records")).toBeVisible();
  await expect(page.getByRole("link", { name: /Source: Students below threshold/ })).toBeVisible();

  await page.getByLabel("Ask CampusOS").fill("what is the weather");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/I answer questions about students/)).toBeVisible();
});

test("search turns a question into an answer, and keeps results in scope", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard shortcut is a desktop affordance");
  await signInAs(page, /Arvind Kulkarni/);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox").fill("students with multiple backlogs");
  await page.getByRole("option", { name: /“students with multiple backlogs”/ }).click();
  await expect(page).toHaveURL(/\/insights\?q=/);
  await expect(page.getByText(/You asked: “students with multiple backlogs”/)).toBeVisible();

  const res = await page.request.get("/api/search?q=Electronics");
  const body = (await res.json()) as { units: { label: string }[] };
  expect(body.units.map((u) => u.label)).not.toContain("Electronics & Communication");
});

test.describe("notices", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(({ isMobile }) => isMobile, "state-changing flows run once, on desktop");

  test("a scheduled notice waits for its time", async ({ page, browser }) => {
    await signInAs(page, /Kavya Nair/);
    await page.goto("/announcements/new");
    await page.getByLabel("Title").fill("3-CSE-A: library orientation next week");
    await page.getByLabel("Summary").fill("Library orientation for 3-CSE-A on Monday 12 October at 14:00.");
    await page.getByLabel("Send to").selectOption({ label: "Section 3-CSE-A" });
    await page.getByLabel(/^Publish at/).fill("2026-10-09T08:00");
    await page.getByRole("button", { name: "Publish" }).click();
    await page.waitForURL("**/announcements/sent");
    await expect(page.getByText(/^Scheduled · /).first()).toBeVisible();

    const student = await browser.newPage();
    await signInAs(student, /Student · /);
    await student.goto("/announcements");
    await expect(student.getByText("library orientation next week")).toHaveCount(0);
    await student.close();
  });

  test("a notice to class incharges reaches them and not students", async ({ page, browser }) => {
    await signInAs(page, /Arvind Kulkarni/);
    await page.goto("/announcements/new");
    await page.getByLabel("Title").fill("Class incharges: mentor list review");
    await page
      .getByLabel("Summary")
      .fill("Please review your class mentor lists before Friday's department meeting.");
    await page.getByLabel("Send to").selectOption({ label: "Computer Science & Engineering" });
    await page.getByLabel("Staff role").selectOption({ label: "Class incharges" });
    await page.getByLabel(/Staff with the role/).check();
    await expect(page.getByText("Publishes immediately.")).toBeVisible();
    await page.getByRole("button", { name: "Publish" }).click();
    await page.waitForURL("**/announcements/sent");

    const kavya = await browser.newPage();
    await signInAs(kavya, /Kavya Nair/);
    await kavya.goto("/announcements?view=important");
    await expect(kavya.getByRole("link", { name: /mentor list review/ })).toBeVisible();
    await kavya.close();

    const student = await browser.newPage();
    await signInAs(student, /Student · /);
    await student.goto("/announcements");
    await expect(student.getByText("mentor list review")).toHaveCount(0);
    await student.close();
  });
});

test("Student 360 is organised in tabs, with honest placeholders for later phases", async ({ page }) => {
  await signInAs(page, /Student · /);
  await page.goto("/students");
  await page.waitForURL(/\/students\/[0-9a-f-]{36}$/);
  const tabs = page.getByRole("navigation", { name: "Student record" });
  for (const t of [
    "Overview",
    "Academics",
    "Attendance",
    "Exams",
    "Fees",
    "Placement",
    "Mentoring",
    "Communication",
    "Documents",
  ])
    await expect(tabs.getByRole("link", { name: t })).toBeVisible();
  await tabs.getByRole("link", { name: "Exams" }).click();
  await expect(page.getByRole("heading", { name: "Registered papers" })).toBeVisible();
  await tabs.getByRole("link", { name: "Placement" }).click();
  await expect(page.getByText("Phase 8")).toBeVisible();
});
