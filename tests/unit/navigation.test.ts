import { describe, expect, it } from "vitest";
import { ROLE_DEFINITIONS, workspaceFor, type WorkspaceKind } from "@/lib/authz/catalogue";
import { findModuleByPath, MODULES } from "@/lib/navigation/modules";
import { flattenNav, navigationFor, workspaceHasModule } from "@/lib/navigation/nav";

const labels = (w: WorkspaceKind, opts = {}) => flattenNav(navigationFor(w, opts)).map((i) => i.label);
const ALL: WorkspaceKind[] = [
  "admin",
  "leadership",
  "department",
  "class",
  "teaching",
  "self",
  "guardian",
  "examinations",
  "operations",
];

describe("role-based navigation", () => {
  it("renders a different workspace for each kind", () => {
    expect(new Set(ALL.map((w) => labels(w).join("|"))).size).toBe(ALL.length);
  });

  it("maps every system role to a workspace", () => {
    expect(workspaceFor("principal")).toBe("leadership");
    expect(workspaceFor("hod")).toBe("department");
    expect(workspaceFor("class_incharge")).toBe("class");
    expect(workspaceFor("faculty")).toBe("teaching");
    expect(workspaceFor("student")).toBe("self");
    expect(workspaceFor("parent")).toBe("guardian");
    expect(workspaceFor("super_admin")).toBe("admin");
    expect(workspaceFor("exam_controller")).toBe("examinations");
    for (const r of ROLE_DEFINITIONS) expect(ALL).toContain(r.workspace);
  });

  it("uses the global navigation names, per role", () => {
    expect(labels("leadership", { canPublish: true })).toEqual(
      expect.arrayContaining([
        "Home",
        "Inbox",
        "Approvals",
        "Insights",
        "Students",
        "Faculty",
        "Academics",
        "Attendance",
        "Examinations",
        "Announcements",
        "Placements",
        "Finance",
        "Mentoring",
        "Accreditation",
        "Reports",
      ]),
    );
    expect(labels("department")).toEqual(
      expect.arrayContaining(["Home", "Inbox", "Students", "Courses", "Faculty", "Approvals", "Marks"]),
    );
    expect(labels("class")).toEqual(
      expect.arrayContaining(["Home", "Attendance", "Marks", "Parent communication", "Mentoring", "Tasks"]),
    );
    expect(labels("teaching")).toEqual(
      expect.arrayContaining(["Home", "My courses", "Attendance", "Tasks", "Assignments"]),
    );
    expect(labels("self")).toEqual(
      expect.arrayContaining([
        "Home",
        "Inbox",
        "Timetable",
        "Attendance",
        "Exams",
        "Results",
        "Assignments",
        "Fees",
        "Placements",
        "My profile",
      ]),
    );
    expect(labels("guardian")).toEqual(expect.arrayContaining(["Home", "Inbox", "Messages", "Timetable"]));
  });

  it("shows Announcements (writing notices) only to those who may publish", () => {
    expect(labels("teaching")).not.toContain("Announcements");
    expect(labels("teaching", { canPublish: true })).toContain("Announcements");
    expect(labels("self", { canPublish: true })).not.toContain("Announcements");
  });

  it("shows Administration to permission holders outside the admin workspace, and only then", () => {
    expect(labels("leadership")).not.toContain("Users & access");
    expect(labels("leadership", { canManageAccess: true, canViewAudit: true })).toEqual(
      expect.arrayContaining(["Users & access", "Audit log"]),
    );
    expect(labels("admin")).toEqual(expect.arrayContaining(["Users & access", "Audit log"]));
  });

  it("does not expose institution analytics or finance to class, teaching or self workspaces", () => {
    for (const w of ["class", "teaching", "self", "guardian"] as const) {
      expect(labels(w)).not.toContain("Analytics");
      expect(labels(w)).not.toContain("Finance");
      expect(workspaceHasModule(w, "analytics")).toBe(false);
    }
  });

  it("points My Profile at the linked Student 360", () => {
    const item = flattenNav(navigationFor("self", { linkedStudentId: "abc" })).find(
      (i) => i.label === "My profile",
    );
    expect(item?.href).toBe("/students/abc");
  });

  it("resolves every navigation item to a registered module route", () => {
    for (const w of ALL) {
      for (const item of flattenNav(navigationFor(w, { canManageAccess: true, canViewAudit: true }))) {
        const mod = MODULES[item.key as keyof typeof MODULES];
        expect(mod).toBeDefined();
        expect(findModuleByPath(mod.path)).toBeDefined();
      }
    }
  });

  it("marks only Phase 0–5 modules as available", () => {
    const available = flattenNav(navigationFor("admin", { canPublish: true }))
      .filter((i) => i.available)
      .map((i) => i.key);
    expect(available.sort()).toEqual([
      "academics",
      "access",
      "announcements",
      "announcements-manage",
      "audit",
      "courses",
      "dashboard",
      "deliveries",
      "faculty",
      "insights",
      "students",
    ]);
    expect(flattenNav(navigationFor("class")).find((i) => i.key === "parent-communication")?.available).toBe(
      true,
    );
    expect(flattenNav(navigationFor("guardian")).find((i) => i.key === "my-messages")?.available).toBe(true);
    expect(flattenNav(navigationFor("teaching")).find((i) => i.key === "my-courses")?.available).toBe(true);
    expect(flattenNav(navigationFor("teaching")).find((i) => i.key === "attendance")?.available).toBe(true);
    expect(flattenNav(navigationFor("teaching")).find((i) => i.key === "marks")?.available).toBe(true);
    expect(flattenNav(navigationFor("leadership")).find((i) => i.key === "exams")?.available).toBe(true);
    expect(flattenNav(navigationFor("leadership")).find((i) => i.key === "mentoring")?.available).toBe(false);
  });
});
