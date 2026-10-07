import { describe, expect, it } from "vitest";
import {
  authorize,
  canEditAttendance,
  canExportStudents,
  canPublishAnnouncement,
  canViewStudent,
  studentFieldAccess,
} from "@/lib/authz/engine";
import { STUDENTS } from "@/lib/demo/fixtures";
import { DEMO_STUDENT_NUMBER } from "@/lib/demo/personas";
import {
  ctxFor,
  DEMO_TENANT_ID,
  demoTree,
  otherTree,
  ref,
  studentIn,
  visibleFor,
} from "../helpers/demo-authz";

const sections = (key: string) => new Set(visibleFor(ctxFor(key)).map((v) => v.student.sectionId));
const depts = (key: string) => new Set(visibleFor(ctxFor(key)).map((v) => v.student.departmentCode));

describe("row scope (PRD §4 effective access)", () => {
  it("gives the principal, director and super admin the whole institution", () => {
    for (const key of ["principal", "director", "super_admin"])
      expect(visibleFor(ctxFor(key))).toHaveLength(STUDENTS.length);
  });

  it("limits the HOD and programme coordinator of CSE to CSE", () => {
    expect(depts("hod_cse")).toEqual(new Set(["CSE"]));
    expect(depts("programme_coordinator")).toEqual(new Set(["CSE"]));
  });

  it("limits faculty to the sections they are assigned to", () => {
    expect(sections("faculty")).toEqual(new Set(["CSE-3-A", "CSE-3-B"]));
  });

  it("unions a multi-role user's scopes: class incharge of 3-CSE-A plus faculty in 3-CSE-B", () => {
    expect(sections("class_incharge")).toEqual(new Set(["CSE-3-A", "CSE-3-B"]));
  });

  it("limits a student to their own record and a parent to their linked child", () => {
    for (const key of ["student", "parent"]) {
      const rows = visibleFor(ctxFor(key));
      expect(rows.map((r) => r.student.studentNumber)).toEqual([DEMO_STUDENT_NUMBER]);
    }
  });

  it("denies a student whose self link is missing, even with the student role", () => {
    expect(visibleFor(ctxFor("student", { links: [] }))).toHaveLength(0);
  });

  it("does not let a parent link stand in for a self link (or vice versa)", () => {
    const parentLinks = ctxFor("parent").links;
    expect(visibleFor(ctxFor("student", { links: parentLinks }))).toHaveLength(0);
  });
});

describe("field sensitivity is decided per record", () => {
  const ownSection = studentIn("CSE-3-A");
  const otherSection = studentIn("CSE-3-B");

  it("gives the class incharge full class fields on 3-CSE-A but only course attendance on 3-CSE-B", () => {
    const ctx = ctxFor("class_incharge");
    const a = studentFieldAccess(ctx, demoTree, ref(ownSection));
    const b = studentFieldAccess(ctx, demoTree, ref(otherSection));
    expect(a).toMatchObject({
      view: true,
      academic: true,
      risk: true,
      contact: true,
      guardian: true,
      finance: false,
      courseAttendance: "all",
    });
    expect(b).toMatchObject({
      view: true,
      academic: false,
      risk: false,
      contact: false,
      finance: false,
      courseAttendance: ["CS302"],
    });
  });

  it("gives faculty only their course's attendance — no CGPA, risk, contact or fees", () => {
    expect(studentFieldAccess(ctxFor("faculty"), demoTree, ref(ownSection))).toEqual({
      view: true,
      contact: false,
      guardian: false,
      academic: false,
      risk: false,
      finance: false,
      courseAttendance: ["CS301"],
    });
  });

  it("isolates finance: the finance officer sees fees but no academics or risk; the HOD the opposite", () => {
    expect(studentFieldAccess(ctxFor("finance"), demoTree, ref(ownSection))).toMatchObject({
      finance: true,
      academic: false,
      risk: false,
    });
    expect(studentFieldAccess(ctxFor("hod_cse"), demoTree, ref(ownSection))).toMatchObject({
      finance: false,
      academic: true,
      risk: true,
    });
  });

  it("gives a parent progress and fees but not risk flags or the student's own contact details", () => {
    const child = STUDENTS.find((s) => s.studentNumber === DEMO_STUDENT_NUMBER)!;
    expect(studentFieldAccess(ctxFor("parent"), demoTree, ref(child))).toMatchObject({
      academic: true,
      finance: true,
      risk: false,
      contact: false,
    });
  });

  it("returns no access at all for out-of-scope records", () => {
    const ece = studentIn("ECE-2-A");
    expect(studentFieldAccess(ctxFor("hod_cse"), demoTree, ref(ece)).view).toBe(false);
  });
});

describe("deny by default", () => {
  const s = studentIn("CSE-3-A");

  it("denies unauthenticated callers", () => {
    expect(authorize(null, demoTree, "student:view", { kind: "student", student: ref(s) })).toMatchObject({
      allowed: false,
      reason: "unauthenticated",
    });
  });

  it("fails closed across tenants — even an institution-wide principal", () => {
    const nf = ctxFor("other_tenant_principal");
    expect(
      authorize(nf, otherTree, "student:view", { kind: "student", student: ref(s, DEMO_TENANT_ID) }),
    ).toMatchObject({
      allowed: false,
      reason: "cross-tenant access",
    });
    // …and using another tenant's tree is refused outright.
    expect(
      authorize(ctxFor("principal"), otherTree, "student:view", { kind: "student", student: ref(s) }).allowed,
    ).toBe(false);
  });

  it("explains whether the permission is missing or the scope is wrong", () => {
    const ece = studentIn("ECE-1-A");
    expect(
      authorize(ctxFor("hod_cse"), demoTree, "student:view", { kind: "student", student: ref(ece) }).reason,
    ).toBe("outside assigned scope");
    expect(
      authorize(ctxFor("hod_cse"), demoTree, "audit:view", { kind: "tenant", tenantId: DEMO_TENANT_ID })
        .reason,
    ).toBe("missing permission audit:view");
  });

  it("drops access as soon as an assignment is gone (revoked or expired assignments are not loaded)", () => {
    expect(canViewStudent(ctxFor("hod_cse", { assignments: [] }), demoTree, ref(s))).toBe(false);
  });

  it("ignores org units that are not in the tenant tree", () => {
    const ctx = ctxFor("hod_cse");
    const ghost = { ...ctx, assignments: ctx.assignments.map((a) => ({ ...a, orgUnitId: "nonexistent" })) };
    expect(canViewStudent(ghost, demoTree, ref(s))).toBe(false);
  });
});

describe("named helpers", () => {
  const unit = (code: string) => demoTree.byCode.get(code)!.id;

  it("separates export from view: HOD can view but not export, principal can export", () => {
    expect(canExportStudents(ctxFor("hod_cse"), demoTree, [unit("CSE")])).toBe(false);
    expect(canExportStudents(ctxFor("principal"), demoTree, [unit("CSE"), unit("ECE")])).toBe(true);
    expect(canExportStudents(ctxFor("principal"), demoTree, [])).toBe(false);
  });

  it("allows attendance editing only in assigned sections", () => {
    expect(canEditAttendance(ctxFor("faculty"), demoTree, "CSE-3-A")).toBe(true);
    expect(canEditAttendance(ctxFor("faculty"), demoTree, "CSE-3-C")).toBe(false);
    expect(canEditAttendance(ctxFor("hod_cse"), demoTree, "CSE-1-B")).toBe(true);
    expect(canEditAttendance(ctxFor("programme_coordinator"), demoTree, "CSE-1-B")).toBe(false);
    expect(canEditAttendance(ctxFor("student"), demoTree, "CSE-3-A")).toBe(false);
  });

  it("scopes publishing: class incharge to their section, HOD to the department, never above", () => {
    expect(canPublishAnnouncement(ctxFor("class_incharge"), demoTree, unit("CSE-3-A"))).toBe(true);
    expect(canPublishAnnouncement(ctxFor("class_incharge"), demoTree, unit("CSE"))).toBe(false);
    expect(canPublishAnnouncement(ctxFor("hod_cse"), demoTree, unit("CSE"))).toBe(true);
    expect(canPublishAnnouncement(ctxFor("hod_cse"), demoTree, unit("DUG"))).toBe(false);
    expect(canPublishAnnouncement(ctxFor("student"), demoTree, unit("CSE-3-A"))).toBe(false);
  });

  it("requires institution-wide scope for tenant resources like the audit trail", () => {
    const tenant = { kind: "tenant" as const, tenantId: DEMO_TENANT_ID };
    expect(authorize(ctxFor("principal"), demoTree, "audit:view", tenant).allowed).toBe(true);
    expect(authorize(ctxFor("super_admin"), demoTree, "audit:view", tenant).allowed).toBe(true);
    expect(authorize(ctxFor("hod_cse"), demoTree, "audit:view", tenant).allowed).toBe(false);
  });
});
