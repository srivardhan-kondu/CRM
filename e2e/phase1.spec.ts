import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./helpers";

/*
 * Phase 1 — identity, tenancy and authorization. These flows change role assignments and sessions, so they run
 * serially, on the desktop project only, against the freshly rebuilt test database.
 */
test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "state-changing admin flows run once, on desktop");

function userRow(page: Page, email: string) {
  return page.locator("li", { hasText: email }).first();
}

test("direct API and URL access fail safely without a session", async ({ request, page }) => {
  expect((await request.get("/api/search?q=a")).status()).toBe(401);
  await page.goto("/admin/access");
  await expect(page).toHaveURL(/\/login$/);
});

test("only administrators can reach access management", async ({ page }) => {
  await signInAs(page, /Arvind Kulkarni/);
  await page.goto("/admin/access");
  await expect(page.getByText(/isn't part of your role/)).toBeVisible();
  await page.goto("/admin/audit");
  await expect(page.getByText(/available to institution-wide administrators/)).toBeVisible();
});

test("principal cannot grant or revoke Super Admin (no privilege escalation in the UI)", async ({ page }) => {
  await signInAs(page, /Meera Raghavan/);
  await page.goto("/admin/access");
  const asha = userRow(page, "platform.admin@demo.campusos.dev");
  await expect(asha.getByRole("button", { name: /Revoke Super Admin/ })).toHaveCount(0);
  await userRow(page, "pc.btech.cse@demo.campusos.dev").getByRole("button", { name: "Grant role" }).click();
  const roleOptions = await page.getByLabel("Role", { exact: true }).locator("option").allInnerTexts();
  expect(roleOptions).toContain("Head of Department");
  expect(roleOptions).not.toContain("Super Admin");
});

test("revoking a role removes access on the user's next request; granting restores it in a new scope", async ({
  browser,
}) => {
  const coordinator = await browser.newPage();
  await signInAs(coordinator, /Sunita Menon/);
  await coordinator.goto("/students");
  await expect(coordinator.getByText(/168 students you can open/)).toBeVisible();

  const admin = await browser.newPage();
  await signInAs(admin, /Meera Raghavan/);
  await admin.goto("/admin/access");
  await userRow(admin, "pc.btech.cse@demo.campusos.dev")
    .getByRole("button", { name: /Revoke Programme Coordinator/ })
    .click();
  await admin.getByLabel("Reason", { exact: true }).fill("Moved to ECE");
  await admin.getByRole("dialog").getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(admin.getByText(/Revoked Programme Coordinator/)).toBeVisible();

  // Same session, next request: no role, no data.
  await coordinator.goto("/dashboard");
  await expect(coordinator.getByText("No role assigned yet")).toBeVisible();
  const none = (await (await coordinator.request.get("/api/search?q=CSE")).json()) as { students: unknown[] };
  expect(none.students).toHaveLength(0);

  // Grant HOD of ECE instead.
  await admin.reload();
  await userRow(admin, "pc.btech.cse@demo.campusos.dev").getByRole("button", { name: "Grant role" }).click();
  await admin.getByLabel("Role", { exact: true }).selectOption({ label: "Head of Department" });
  const scope = admin.getByLabel("Scope", { exact: true });
  await scope.selectOption(
    (await scope.locator("option", { hasText: "Electronics & Communication" }).getAttribute("value"))!,
  );
  await admin.getByRole("dialog").getByRole("button", { name: "Grant role" }).click();
  await expect(admin.getByText(/Granted Head of Department on Electronics & Communication/)).toBeVisible();

  await coordinator.goto("/students");
  await expect(coordinator.getByText(/80 students you can open/)).toBeVisible();
  const search = (await (await coordinator.request.get("/api/search?q=CSE")).json()) as {
    students: unknown[];
  };
  expect(search.students).toHaveLength(0);

  await admin.close();
  await coordinator.close();
});

test("sign out everywhere ends the user's sessions immediately", async ({ browser }) => {
  const faculty = await browser.newPage();
  await signInAs(faculty, /Rahul Verma/);

  const admin = await browser.newPage();
  await signInAs(admin, /Meera Raghavan/);
  await admin.goto("/admin/access");
  await userRow(admin, "rahul.verma@demo.campusos.dev")
    .getByRole("button", { name: /More actions/ })
    .click();
  await admin.getByRole("menuitem", { name: "Sign out everywhere" }).click();
  await expect(admin.getByText(/Signed rahul.verma@demo.campusos.dev out of \d+ sessions?/)).toBeVisible();

  await faculty.goto("/dashboard");
  await expect(faculty).toHaveURL(/\/login$/);
  await admin.close();
  await faculty.close();
});

test("every privileged change and sensitive read is in the audit log", async ({ page }) => {
  await signInAs(page, /Meera Raghavan/);
  const student = (await (await page.request.get("/api/search?q=24CSE001")).json()) as {
    students: { id: string }[];
  };
  await page.goto(`/students/${student.students[0]!.id}`);

  await page.goto("/admin/audit");
  for (const action of [
    "role_assignment.revoke",
    "role_assignment.grant",
    "session.revoke",
    "student.view",
    "auth.sign_in",
  ]) {
    await expect(page.getByRole("cell", { name: action, exact: true }).first()).toBeVisible();
  }
});

test("another institution's principal sees none of this tenant's data", async ({ page, browser }) => {
  const principal = await browser.newPage();
  await signInAs(principal, /Meera Raghavan/);
  const { students } = (await (await principal.request.get("/api/search?q=24CSE001")).json()) as {
    students: { id: string }[];
  };
  await principal.close();

  await signInAs(page, /Rohan Iyer/);
  await page.goto("/students");
  await expect(page.getByText(/0 students you can open/)).toBeVisible();
  await page.goto(`/students/${students[0]!.id}`);
  await expect(page.getByRole("heading", { name: "Student not found" })).toBeVisible();
  const search = (await (await page.request.get("/api/search?q=24CSE")).json()) as { students: unknown[] };
  expect(search.students).toHaveLength(0);
});
