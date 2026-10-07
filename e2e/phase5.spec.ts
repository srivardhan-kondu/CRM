import { expect, test } from "@playwright/test";
import { signInAs } from "./helpers";

/*
 * Phase 5 — Campus Communication Hub. At DEMO_NOW (Tue 6 Oct 2026, 09:30 IST) the seed has published notices with
 * synthetic reads, two notices awaiting approval (the programme coordinator's to CSE year 3, the CoE's to all
 * students), Ms. Kavya Nair's draft, her shortage messages from 30 September, and a meeting request to the parent
 * persona sent at 21:40 last night whose email is held for quiet hours. State-changing flows run serially on desktop.
 */
test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "state-changing communication flows run once, on desktop");

const PARENT = /(Father|Mother|Guardian) of /;

test("a student reads and acknowledges a critical notice", async ({ page }) => {
  await signInAs(page, /Student · /);
  await page.goto("/announcements?view=today");
  await page
    .getByRole("link", { name: /heavy rainfall advisory/ })
    .first()
    .click();
  await expect(page.getByText("This notice requires your acknowledgement.")).toBeVisible();
  await page.getByRole("button", { name: "Acknowledge" }).click();
  await expect(page.getByText("You acknowledged this notice.")).toBeVisible();

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
  await page.goto("/announcements?view=saved");
  await expect(page.getByRole("link", { name: /heavy rainfall advisory/ })).toBeVisible();
});

test("attachments download only for those who can see the notice", async ({ page, browser }) => {
  await signInAs(page, /Student · /);
  await page.goto("/announcements?view=jobs");
  await page.getByRole("link", { name: /Contoso Analytics/ }).click();
  const href = await page
    .getByRole("link", { name: /^Download / })
    .first()
    .getAttribute("href");
  expect(href).toMatch(/^\/api\/announcements\/[0-9a-f-]+\/attachments\/[0-9a-f-]+$/);
  const ok = await page.request.get(href!);
  expect(ok.status()).toBe(200);
  expect(ok.headers()["content-type"]).toBe("application/pdf");
  expect(ok.headers()["content-disposition"]).toMatch(/^attachment;/);

  // Placement notices are for students; the parent has no access to the notice or its file.
  const parent = await browser.newPage();
  await signInAs(parent, PARENT);
  expect((await parent.request.get(href!)).status()).toBe(404);
  await parent.close();
});

test("the class incharge publishes a section notice that reaches the section's families", async ({
  page,
  browser,
}) => {
  await signInAs(page, /Kavya Nair/);
  await page.goto("/announcements/new");
  await page.getByLabel("Title").fill("3-CSE-A: parent-teacher meeting on Saturday");
  await page
    .getByLabel("Summary")
    .fill("Parents of 3-CSE-A are invited on Saturday 10 October at 10:00 in TB-204.");
  await page.getByLabel("Send to").selectOption({ label: "Section 3-CSE-A" });
  await page.getByLabel("Students & guardians").check();
  await page.getByLabel("Ask recipients to acknowledge").check();
  await expect(page.getByText("Publishes immediately.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await page.waitForURL("**/announcements/sent");
  await page.getByRole("link", { name: /parent-teacher meeting on Saturday/ }).click();
  await expect(page.getByText(/Section 3-CSE-A · Students & guardians/).first()).toBeVisible();
  await expect(page.getByText("Guardians", { exact: true })).toBeVisible();

  const parent = await browser.newPage();
  await signInAs(parent, PARENT);
  await parent.goto("/announcements?view=today");
  await expect(parent.getByRole("link", { name: /parent-teacher meeting on Saturday/ })).toBeVisible();
  await parent.close();
});

test("a broad notice from a coordinator waits for the HOD, who returns it with a note", async ({
  page,
  browser,
}) => {
  await signInAs(page, /Arvind Kulkarni/);
  await page.goto("/approvals");
  await expect(page.getByText("Announcements awaiting approval")).toBeVisible();
  await page.getByRole("button", { name: /^Return “B\.Tech CSE: open elective/ }).click();
  await page.getByLabel("Note").fill("Add the list of electives on offer before sending.");
  await page.getByRole("dialog").getByRole("button", { name: "Return", exact: true }).click();
  await expect(page.getByText(/returned to Dr\. Sunita Menon/)).toBeVisible();

  const coordinator = await browser.newPage();
  await signInAs(coordinator, /Sunita Menon/);
  await coordinator.goto("/announcements/sent");
  await coordinator.getByRole("link", { name: /open elective preferences/ }).click();
  await expect(coordinator.getByText(/Returned: “Add the list of electives/)).toBeVisible();
  await coordinator.close();
});

test("the principal approves the CoE's notice and students receive it", async ({ page, browser }) => {
  await signInAs(page, /Meera Raghavan/);
  await page.goto("/approvals");
  await page.getByRole("button", { name: /^Approve & publish “Hall tickets/ }).click();
  await expect(
    page.getByText(/“Hall tickets: verify your photograph and name by 20 October” approved and published\./),
  ).toBeVisible();

  const student = await browser.newPage();
  await signInAs(student, /Student · /);
  await student.goto("/announcements?view=exams");
  await expect(student.getByRole("link", { name: /Hall tickets: verify your photograph/ })).toBeVisible();
  await student.close();
});

test("the class incharge sends personalised shortage messages to suggested guardians", async ({ page }) => {
  await signInAs(page, /Kavya Nair/);
  await page.goto("/parent-communication");
  await expect(page.getByText("Guardians to inform")).toBeVisible();
  await page.getByRole("button", { name: /Select suggested/ }).click();
  await expect(page.getByText(/Preview for .+'s guardian/)).toBeVisible();
  await page.getByRole("button", { name: /^Send to \d+ guardians?$/ }).click();
  await expect(page.getByText(/Sent to the guardians of \d+ students?\./)).toBeVisible();
});

test("the parent acknowledges a message with a reply, and the sender is told", async ({ page, browser }) => {
  await signInAs(page, PARENT);
  await page.goto("/my/messages");
  await expect(page.getByRole("heading", { name: /Request to meet/ })).toBeVisible();
  await page.getByLabel("Reply (optional)").first().fill("Saturday morning works for us.");
  await page.getByRole("button", { name: "Acknowledge" }).first().click();
  await expect(page.getByText("Acknowledged — your reply was sent.")).toBeVisible();

  const kavya = await browser.newPage();
  await signInAs(kavya, /Kavya Nair/);
  await kavya.goto("/parent-communication");
  await expect(kavya.getByText("“Saturday morning works for us.”")).toBeVisible();
  await kavya.getByRole("button", { name: /^Notifications, [1-9]/ }).click();
  await expect(kavya.getByText(/^Reply from /).first()).toBeVisible();
  await kavya.close();
});

test("the platform admin releases messages held for quiet hours", async ({ page }) => {
  await signInAs(page, /Asha Menon/);
  await page.goto("/admin/deliveries?status=held");
  await expect(page.getByText("Request to meet", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: /^Release \d+ due now$/ }).click();
  await expect(page.getByText(/^\d+ sent/)).toBeVisible();
  await page.goto("/admin/deliveries?status=held");
  await expect(page.getByText("No messages in this state.")).toBeVisible();
});

test("roles without guardian messaging see an explanation, not the module", async ({ page }) => {
  await signInAs(page, /Leela Krishnan/);
  await page.goto("/parent-communication");
  await expect(page.getByText(/Class incharges, HODs and the principal message guardians/)).toBeVisible();
});
