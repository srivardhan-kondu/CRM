import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./helpers";

/*
 * Phase 4 — assessment, examinations and results. At DEMO_NOW (6 Oct 2026) IA-1 is moderated almost everywhere, the
 * September supplementary examinations are marked except one paper, and the November examinations are scheduled.
 * State-changing flows run serially on desktop; like Phase 3 they avoid Rahul Verma (Phase 1 signs him out).
 */
test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "state-changing examination flows run once, on desktop");

const item = (page: Page, text: string | RegExp) => page.locator("li", { hasText: text });

test("a teacher completes and submits internal marks", async ({ page }) => {
  await signInAs(page, /Kavya Nair/);
  await page.goto("/marks");
  await page.getByRole("link").filter({ hasText: "CS302" }).filter({ hasText: "3-CSE-A" }).first().click();
  await expect(page.getByRole("heading", { name: "Internal assessment 1" })).toBeVisible();
  const inputs = page.getByRole("textbox", { name: /^Marks for / });
  for (let i = 0; i < (await inputs.count()); i++) {
    const input = inputs.nth(i);
    if ((await input.inputValue()) === "") await input.fill("12");
  }
  await page.getByRole("button", { name: "Save marks" }).click();
  await expect(page.getByText(/CS302 3-CSE-A: 14 entries saved\./)).toBeVisible();
  await page.getByRole("button", { name: "Submit to HOD" }).click();
  await expect(
    page.getByText("Internal assessment 1 for CS302 · 3-CSE-A submitted to the HOD."),
  ).toBeVisible();
});

test("the HOD returns one submission with a note and approves another", async ({ page }) => {
  await signInAs(page, /Arvind Kulkarni/);
  await page.goto("/marks");
  await page.getByRole("link", { name: /Internal assessment 1 — CS302 · 3-CSE-A/ }).click();
  await page.getByRole("button", { name: /^Return / }).click();
  await page.getByLabel("Note").fill("Two marks look swapped — please recheck 24CSE009 and 24CSE010.");
  await page.getByRole("dialog").getByRole("button", { name: "Return", exact: true }).click();
  await expect(
    page.getByText("Internal assessment 1 · CS302 3-CSE-A returned to Ms. Kavya Nair."),
  ).toBeVisible();

  await page.goto("/marks");
  await page.getByRole("link", { name: /Internal assessment 1 — CS301 · 3-CSE-A/ }).click();
  await page.getByRole("button", { name: /^Approve / }).click();
  await expect(page.getByText("Internal assessment 1 · CS301 3-CSE-A approved and locked.")).toBeVisible();
  await expect(page.getByText("Approved · locked")).toBeVisible();
});

test("the teacher sees the HOD's note on returned marks", async ({ page }) => {
  await signInAs(page, /Kavya Nair/);
  await page.goto("/marks");
  await page.getByRole("link").filter({ hasText: "CS302" }).filter({ hasText: "3-CSE-A" }).first().click();
  await expect(page.getByText(/Returned by Prof\. Arvind Kulkarni: “Two marks look swapped/)).toBeVisible();
});

test("the exam cell enters the last paper and publishes the supplementary results", async ({ page }) => {
  await signInAs(page, /Leela Krishnan/);
  await page.goto("/exams");
  await page.getByRole("link", { name: /Supplementary examinations, September 2026/ }).click();
  await expect(page.getByText(/1 semester-end marks are still to be entered\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish results" })).toBeDisabled();
  await page.getByRole("link", { name: "CA101", exact: true }).click();
  await page
    .getByRole("textbox", { name: /^Marks for / })
    .first()
    .fill("35");
  await page.getByRole("button", { name: "Save marks" }).click();
  await expect(page.getByText("CA101: 1 semester-end marks saved.")).toBeVisible();

  await page.getByRole("link", { name: "SUPP-2026-09" }).click();
  await page.getByRole("button", { name: "Publish results" }).click();
  await expect(
    page.getByText(/Supplementary examinations, September 2026: \d+ results published, \d+ passed\./),
  ).toBeVisible();
  await expect(page.getByText("Results published")).toBeVisible();
});

test("the CoE condones a student in the band", async ({ page }) => {
  await signInAs(page, /Leela Krishnan/);
  await page.goto("/exams");
  await page
    .getByRole("button", { name: /^Approve condonation for / })
    .first()
    .click();
  await expect(page.getByText(/Condoned: .* may sit the semester-end examinations\./)).toBeVisible();
});

test("a student sees the hall ticket and the cleared backlog, and requests revaluation", async ({
  browser,
}) => {
  const student = await browser.newPage();
  await signInAs(student, /Student · /);
  await student.goto("/my/exams");
  await expect(student.getByText(/Eligible to sit/)).toBeVisible();
  await expect(
    student.getByRole("heading", { name: "Semester-end examinations, November 2026" }),
  ).toBeVisible();

  await student.goto("/my/academics");
  const retake = student.getByRole("row").filter({ hasText: "CS202" }).filter({ hasText: "attempt 2" });
  await expect(retake.getByText("Pass")).toBeVisible();
  await retake.getByRole("button", { name: "Request revaluation" }).click();
  await expect(student.getByText(/Revaluation of CS202 requested\./)).toBeVisible();

  const coe = await browser.newPage();
  await signInAs(coe, /Leela Krishnan/);
  await coe.goto("/exams");
  await coe.getByLabel("Revalued mark for CS202 Siddharth Bose").fill("36");
  await item(coe, "CS202 · Siddharth Bose").getByRole("button", { name: "Record" }).click();
  await expect(coe.getByText(/CS202 for Siddharth Bose: revalued to 36\/60, grade /)).toBeVisible();
  await coe.close();

  await student.reload();
  await expect(
    student
      .getByRole("row")
      .filter({ hasText: "CS202" })
      .filter({ hasText: "attempt 2" })
      .getByText("was 31"),
  ).toBeVisible();
  await student.close();
});

test("a student cannot open the examination cell", async ({ page }) => {
  await signInAs(page, /Student · /);
  await page.goto("/exams");
  await expect(
    page.getByText("Examinations are run by the examination cell.", { exact: false }),
  ).toBeVisible();
});
