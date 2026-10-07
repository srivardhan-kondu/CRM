import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./helpers";

/*
 * Phase 3 — attendance and class operations. The demo institution's clock is Tuesday 6 Oct 2026, 09:30 IST, so
 * 3-CSE-A's 09:00 CS301 class is open for marking. These flows change data, so the file runs serially on desktop.
 * It avoids Rahul Verma, whose sessions Phase 1 signs out in parallel: Kavya Nair, the class incharge, marks his
 * class as a substitute, which is itself a case worth covering.
 */
test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "state-changing attendance flows run once, on desktop");

const item = (page: Page, text: string) => page.locator("li", { hasText: text });

let markUrl = "";

test("the class incharge marks today's class as a substitute; the timetable shows it marked", async ({
  page,
}) => {
  await signInAs(page, /Kavya Nair/);
  const cs301 = item(page, "Database Management Systems").filter({
    has: page.getByRole("link", { name: "Take attendance" }),
  });
  // CS302 at 10:00 has not started, so it offers no marking.
  await expect(item(page, "Operating Systems").getByRole("link", { name: "Take attendance" })).toHaveCount(0);
  await cs301.getByRole("link", { name: "Take attendance" }).click();
  await page.waitForURL(/\/attendance\/mark\//);
  markUrl = page.url();
  await expect(page.getByText(/Marking is open until midnight today/)).toBeVisible();

  await page.getByRole("radiogroup").first().getByText("Absent").click();
  await expect(page.getByText("1 absent", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save attendance" }).click();
  await expect(page.getByText(/CS301 · 3-CSE-A: \d+ present, 1 absent\. Saved\./)).toBeVisible();

  await page.goto("/dashboard");
  await expect(item(page, "Database Management Systems").getByText(/Marked · \d+\/\d+/)).toBeVisible();
});

test("a student cannot open a class's marking screen", async ({ page }) => {
  await signInAs(page, /Student · /);
  await page.goto(markUrl);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("changes after the day go to the HOD, who approves them", async ({ browser }) => {
  const kavya = await browser.newPage();
  await signInAs(kavya, /Kavya Nair/);
  await kavya.goto("/my/courses");
  await kavya.getByRole("link").filter({ hasText: "CS302" }).filter({ hasText: "3-CSE-A" }).first().click();
  await kavya.getByRole("link", { name: "Correct" }).first().click();
  await expect(kavya.getByRole("heading", { name: "Request a correction" })).toBeVisible();
  const first = kavya.getByRole("radiogroup").first();
  const wasAbsent = await first.getByRole("radio", { name: "Absent" }).isChecked();
  await first.getByText(wasAbsent ? "Present" : "Absent").click();
  await kavya
    .getByLabel("Reason for the change")
    .fill("Late arrival was marked absent; present from 10 minutes in.");
  await kavya.getByRole("button", { name: "Send for approval" }).click();
  await expect(kavya.getByText(/Correction for CS302 · 3-CSE-A on .* sent for approval\./)).toBeVisible();
  await kavya.close();

  const hod = await browser.newPage();
  await signInAs(hod, /Arvind Kulkarni/);
  await hod.goto("/approvals");
  // Rahul Verma's seeded correction is past its 48-hour limit: shown as overdue.
  await expect(
    item(hod, "3-CSE-B, CS301")
      .getByText(/Overdue/)
      .first(),
  ).toBeVisible();
  const mine = item(hod, "3-CSE-A, CS302").filter({ has: hod.getByRole("button", { name: /^Approve/ }) });
  await expect(mine.getByText("1 mark change")).toBeVisible();
  await mine.getByRole("button", { name: /^Approve/ }).click();
  await expect(hod.getByText(/Approved: CS302 · 3-CSE-A on .* is updated\./)).toBeVisible();
  await hod.close();
});

test("rejecting a request needs a note for the requester", async ({ page }) => {
  await signInAs(page, /Arvind Kulkarni/);
  await page.goto("/approvals");
  await item(page, "3-CSE-B, CS301")
    .filter({ has: page.getByRole("button", { name: /^Reject/ }) })
    .getByRole("button", { name: /^Reject/ })
    .click();
  await page
    .getByLabel("Note to the requester")
    .fill("The seminar register shows only one of them. Resubmit for that student.");
  await page.getByRole("dialog").getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByText("Rejected and returned to Mr. Rahul Verma.")).toBeVisible();
});

test("approved medical leave excuses the absences it covers", async ({ browser }) => {
  const parent = await browser.newPage();
  await signInAs(parent, /Father of Siddharth Bose/);
  await parent.goto("/my/attendance");
  await expect(item(parent, "Fever; doctor advised rest").getByText("pending")).toBeVisible();
  await parent.close();

  const kavya = await browser.newPage();
  await signInAs(kavya, /Kavya Nair/);
  await kavya.goto("/approvals");
  const leave = item(kavya, "Medical leave — Siddharth Bose").filter({
    has: kavya.getByRole("button", { name: /^Approve/ }),
  });
  await leave.getByRole("button", { name: /^Approve/ }).click();
  await expect(
    kavya.getByText(/Approved\. Siddharth Bose's attendance now counts the medical days as excused\./),
  ).toBeVisible();
  await kavya.close();

  const student = await browser.newPage();
  await signInAs(student, /Student · /);
  await student.goto("/my/attendance");
  await expect(student.getByText("Excused", { exact: true }).first()).toBeVisible();
  await expect(item(student, "Fever; doctor advised rest").getByText("approved")).toBeVisible();
  await student.close();
});

test("a student applies for on-duty leave and can withdraw it while pending", async ({ page }) => {
  await signInAs(page, /Student · /);
  await page.goto("/my/attendance");
  await page.getByRole("button", { name: "Apply for leave" }).click();
  await page.getByLabel("Type").selectOption("od");
  await page.getByLabel("From").fill("2026-10-08");
  await page.getByLabel("To").fill("2026-10-09");
  await page.getByLabel("Reason").fill("Selected for the state-level coding contest");
  await page.getByRole("button", { name: "Send application" }).click();
  await expect(page.getByText("On-duty leave for Siddharth Bose sent to the class incharge.")).toBeVisible();
  const pending = item(page, "state-level coding contest");
  await pending.getByRole("button", { name: "Withdraw" }).click();
  await expect(page.getByText("Application withdrawn.")).toBeVisible();
  await expect(pending.getByText("withdrawn")).toBeVisible();
});

test("the principal sees section attendance and marking gaps", async ({ page }) => {
  await signInAs(page, /Meera Raghavan/);
  await page.goto("/attendance");
  await page.getByRole("link", { name: "3-CSE-A", exact: true }).click();
  await expect(page.getByRole("heading", { name: "3-CSE-A attendance" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "CS301" })).toBeVisible();

  // 2-MECH-A's latest MA203 class was submitted late and waits for the principal (no MECH head is a persona).
  await page.goto("/attendance/sections/MECH-2-A");
  await expect(item(page, "MA203").getByText("Awaiting approval")).toBeVisible();
  await page.goto("/approvals");
  await expect(page.getByText(/Late attendance — 2-MECH-A, MA203/)).toBeVisible();
});
