import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./helpers";

/*
 * Phase 2 — academic structure and the Student 360 kernel. Allocation and transfer flows change data, so the file
 * runs serially on desktop against the freshly rebuilt test database. It avoids the personas Phase 1 signs out.
 */
test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "state-changing academic flows run once, on desktop");

function sectionCard(page: Page, label: string) {
  return page.locator("section", {
    has: page.getByRole("heading", { name: `Section ${label}`, exact: true }),
  });
}

test("principal browses programmes, regulations and batches", async ({ page }) => {
  await signInAs(page, /Meera Raghavan/);
  await page.goto("/academics");
  await expect(page.getByRole("heading", { name: "Academic structure" })).toBeVisible();
  await expect(page.getByText("Odd semester 2026–27").first()).toBeVisible();
  await page
    .getByRole("link", { name: /B\.Tech CSE/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/academics\/programmes\/BTECH-CSE/);
  // Default view: the newest active regulation, semester by semester.
  await expect(page.getByRole("tab", { name: /R24/, selected: true })).toBeVisible();
  await expect(page.getByText("Database Management Systems")).toBeVisible();
  // R22 → R24 revised final-year electives; R26 is a draft with a publish action.
  await page.getByRole("tab", { name: /R26/ }).click();
  await expect(page.getByRole("button", { name: /Publish/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: /B\.Tech CSE 2023/ })).toBeVisible();
});

test("faculty see their own courses and course-level rosters", async ({ page }) => {
  await signInAs(page, /Kavya Nair/);
  await page.goto("/my/courses");
  await expect(page.getByText("Section 3-CSE-A · 14 students")).toBeVisible();
  await page.getByRole("link", { name: /Section 3-CSE-B/ }).click();
  await expect(page.getByRole("heading", { name: /CS302 · Operating Systems/ })).toBeVisible();
  await expect(page.getByText(/Lowest CS302 attendance first/)).toBeVisible();
  // Faculty profiles and load are not part of a class incharge's role.
  await page.goto("/faculty");
  await expect(page.getByText(/aren't part of your role/)).toBeVisible();
});

test("removing an allocation removes teaching access on the next request; allocating restores it", async ({
  browser,
}) => {
  const kavya = await browser.newPage();
  await signInAs(kavya, /Kavya Nair/);
  await kavya.goto("/students");
  await expect(kavya.getByText(/28 students you can open/)).toBeVisible();

  const hod = await browser.newPage();
  await signInAs(hod, /Arvind Kulkarni/);
  await hod.goto("/courses");
  const row = sectionCard(hod, "3-CSE-B").locator("li", { hasText: "CS302" });
  await row.getByRole("button", { name: "Remove Ms. Kavya Nair" }).click();
  await hod.getByLabel("Reason").fill("Load rebalancing");
  await hod.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
  await expect(hod.getByText("Ms. Kavya Nair no longer teaches CS302 to 3-CSE-B.")).toBeVisible();

  await kavya.goto("/students");
  await expect(kavya.getByText(/14 students you can open/)).toBeVisible();

  await row.getByRole("button", { name: "Allocate" }).click();
  const select = hod.getByLabel("Faculty member");
  await select.selectOption(
    (await select.locator("option", { hasText: "Ms. Kavya Nair" }).getAttribute("value"))!,
  );
  await hod.getByRole("dialog").getByRole("button", { name: "Allocate", exact: true }).click();
  await expect(hod.getByText(/Ms. Kavya Nair now teaches CS302 to 3-CSE-B/)).toBeVisible();

  await kavya.goto("/students");
  await expect(kavya.getByText(/28 students you can open/)).toBeVisible();
  await hod.close();
  await kavya.close();
});

test("HOD fills an unallocated offering, within their department only", async ({ page }) => {
  await signInAs(page, /Arvind Kulkarni/);
  await page.goto("/courses");
  await expect(sectionCard(page, "2-ECE-B")).toHaveCount(0);
  const row = sectionCard(page, "3-CSE-C").locator("li", { hasText: "CS305" });
  await expect(row.getByText("Unallocated")).toBeVisible();
  await row.getByRole("button", { name: "Allocate" }).click();
  const select = page.getByLabel("Faculty member");
  await select.selectOption({ index: 1 });
  await page.getByRole("dialog").getByRole("button", { name: "Allocate", exact: true }).click();
  await expect(page.getByText(/now teaches CS305 to 3-CSE-C/)).toBeVisible();
  await expect(row.getByText("Unallocated")).toHaveCount(0);

  await page.goto("/faculty");
  await expect(page.getByRole("heading", { name: "Computer Science & Engineering" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Electronics & Communication" })).toHaveCount(0);
});

test("principal moves a student between sections with the reason kept on the record", async ({ page }) => {
  await signInAs(page, /Meera Raghavan/);
  const { students } = (await (await page.request.get("/api/search?q=2-CSE-A")).json()) as {
    students: { id: string; name: string }[];
  };
  await page.goto(`/students/${students[0]!.id}`);
  await page.getByRole("button", { name: "Move section" }).click();
  await page.getByLabel("New section").selectOption({ label: "2-CSE-B" });
  await page.getByLabel("Reason").fill("Elective group rebalancing");
  await page.getByRole("button", { name: "Move student" }).click();
  await expect(page.getByText(/moved to section 2-CSE-B/)).toBeVisible();
  await expect(page.getByText("Section history")).toBeVisible();
  await expect(page.getByText("Moved to section 2-CSE-B", { exact: true })).toBeVisible();

  await page.goto("/admin/audit");
  for (const action of ["student.transfer", "teaching.allocate", "teaching.remove"]) {
    await expect(page.getByRole("cell", { name: action, exact: true }).first()).toBeVisible();
  }
});

test("Student 360 shows the student's regulation and this term's teachers", async ({ page }) => {
  await signInAs(page, /Student · /);
  await page.goto("/students");
  await expect(page.getByRole("heading", { name: "Programme & enrolment" })).toBeVisible();
  await expect(page.getByText("R24", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Mr. Rahul Verma" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Move section" })).toHaveCount(0);
});
