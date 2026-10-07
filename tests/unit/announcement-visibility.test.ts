import { describe, expect, it } from "vitest";
import type { AudienceRule, InboxItem } from "@/domains/announcements/types";
import {
  inView,
  isAddressedTo,
  isVisibleTo,
  recipientKeys,
  type Viewer,
} from "@/domains/announcements/visibility";
import { ANNOUNCEMENTS, type SeedAnnouncement } from "@/lib/demo/announcements";
import { DEMO_NOW, STUDENTS } from "@/lib/demo/fixtures";
import { demoTree } from "../helpers/demo-authz";

const staff = (...codes: string[]): Viewer => ({
  tree: demoTree,
  staffUnits: codes.map((c) => demoTree.byCode.get(c)!),
  students: [],
});
const linked = (sectionId: string, relation: "self" | "guardian"): Viewer => ({
  tree: demoTree,
  staffUnits: [],
  students: [{ ...STUDENTS.find((x) => x.sectionId === sectionId)!, relation }],
});
const studentOf = (sectionId: string) => linked(sectionId, "self");
const guardianOf = (sectionId: string) => linked(sectionId, "guardian");

const principal = staff("DUG");
const hodCse = staff("CSE");
const ci3A = staff("CSE-3-A");
const faculty = staff("CSE-3-A", "CSE-3-B");
const eceDept: AudienceRule = { kind: "department", departmentCode: "ECE", audience: "students" };

describe("announcement targeting", () => {
  it("never shows a department notice to another department (PRD Phase 5 critical requirement)", () => {
    for (const viewer of [
      hodCse,
      ci3A,
      faculty,
      studentOf("CSE-3-A"),
      studentOf("CSE-1-B"),
      guardianOf("CSE-3-A"),
    ]) {
      expect(isVisibleTo(eceDept, viewer)).toBe(false);
    }
    expect(isVisibleTo(eceDept, studentOf("ECE-2-A"))).toBe(true);
  });

  it("scopes campus-level staff to their campus", () => {
    const techCampus = staff("TECH");
    expect(isVisibleTo(eceDept, techCampus)).toBe(true);
    expect(isVisibleTo({ kind: "department", departmentCode: "MBA", audience: "everyone" }, techCampus)).toBe(
      false,
    );
  });

  it("keeps staff-only notices away from students and guardians", () => {
    const staffOnly: AudienceRule = { kind: "institution", audience: "staff" };
    expect(isVisibleTo(staffOnly, studentOf("CSE-3-A"))).toBe(false);
    expect(isVisibleTo(staffOnly, guardianOf("CSE-3-A"))).toBe(false);
    expect(isAddressedTo(staffOnly, faculty)).toBe(true);
  });

  it("separates students from guardians", () => {
    const toStudents: AudienceRule = { kind: "section", sectionId: "CSE-3-A", audience: "students" };
    const toGuardians: AudienceRule = { kind: "section", sectionId: "CSE-3-A", audience: "guardians" };
    const families: AudienceRule = { kind: "section", sectionId: "CSE-3-A", audience: "families" };
    expect(isVisibleTo(toStudents, studentOf("CSE-3-A"))).toBe(true);
    expect(isVisibleTo(toStudents, guardianOf("CSE-3-A"))).toBe(false);
    expect(isVisibleTo(toGuardians, studentOf("CSE-3-A"))).toBe(false);
    expect(isVisibleTo(toGuardians, guardianOf("CSE-3-A"))).toBe(true);
    expect(isVisibleTo(families, studentOf("CSE-3-A"))).toBe(true);
    expect(isVisibleTo(families, guardianOf("CSE-3-A"))).toBe(true);
  });

  it("delivers a section notice only to that section", () => {
    const rule: AudienceRule = { kind: "section", sectionId: "CSE-3-A", audience: "everyone" };
    expect(isVisibleTo(rule, studentOf("CSE-3-A"))).toBe(true);
    expect(isVisibleTo(rule, studentOf("CSE-3-B"))).toBe(false);
    expect(isVisibleTo(rule, ci3A)).toBe(true);
    expect(isVisibleTo(rule, staff("CSE-3-B"))).toBe(false);
    expect(isVisibleTo(rule, hodCse)).toBe(true);
  });

  it("shows staff the student notices in their scope without addressing them", () => {
    const rule: AudienceRule = { kind: "section", sectionId: "CSE-3-A", audience: "students" };
    expect(isVisibleTo(rule, ci3A)).toBe(true);
    expect(isAddressedTo(rule, ci3A)).toBe(false);
    expect(recipientKeys(rule, ci3A, "u1")).toEqual([]);
  });

  it("gives each viewer the receipt keys they answer for", () => {
    const rule: AudienceRule = { kind: "section", sectionId: "CSE-3-A", audience: "everyone" };
    const s = STUDENTS.find((x) => x.sectionId === "CSE-3-A")!;
    expect(recipientKeys(rule, studentOf("CSE-3-A"), "u1")).toEqual([`s:${s.id}`]);
    expect(recipientKeys(rule, guardianOf("CSE-3-A"), "u2")).toEqual([`g:${s.id}`]);
    expect(recipientKeys(rule, ci3A, "u3")).toEqual(["u:u3"]);
  });

  it("matches year and placement-eligible rules on department and year", () => {
    const mba2: AudienceRule = { kind: "year", departmentCode: "MBA", year: 2, audience: "students" };
    expect(isVisibleTo(mba2, studentOf("MBA-2-A"))).toBe(true);
    expect(isVisibleTo(mba2, studentOf("MBA-1-A"))).toBe(false);
    expect(isVisibleTo(mba2, hodCse)).toBe(false);

    const finalYear: AudienceRule = { kind: "placement_eligible", departmentCodes: ["CSE", "ECE"], year: 4 };
    expect(isVisibleTo(finalYear, studentOf("CSE-4-A"))).toBe(true);
    expect(isVisibleTo(finalYear, guardianOf("CSE-4-A"))).toBe(false);
    expect(isVisibleTo(finalYear, studentOf("CSE-3-A"))).toBe(false);
    expect(isVisibleTo(finalYear, ci3A)).toBe(false);
    expect(isVisibleTo(finalYear, hodCse)).toBe(true);
  });

  it("denies a viewer with no units and no linked students", () => {
    expect(
      isVisibleTo(
        { kind: "institution", audience: "everyone" },
        { tree: demoTree, staffUnits: [], students: [] },
      ),
    ).toBe(false);
  });

  it("lets the principal see every notice", () => {
    expect(ANNOUNCEMENTS.every((a) => isVisibleTo(a.audience, principal))).toBe(true);
  });
});

describe("inbox views", () => {
  const item = (id: string, state: Partial<InboxItem> = {}): InboxItem => {
    const a: SeedAnnouncement = ANNOUNCEMENTS.find((x) => x.id === id)!;
    return {
      ...a,
      authorId: null,
      audienceLabel: "",
      audienceUnitId: "",
      attachments: [],
      addressed: true,
      read: false,
      acknowledged: false,
      saved: false,
      ...state,
    };
  };

  it("moves expired notices to history only", () => {
    const old = item("an-orientation");
    expect(inView(old, "history", DEMO_NOW)).toBe(true);
    expect(inView(old, "mine", DEMO_NOW)).toBe(false);
    expect(inView(old, "today", DEMO_NOW)).toBe(false);
  });

  it("puts critical active notices in Today", () => {
    expect(inView(item("an-rain-advisory"), "today", DEMO_NOW)).toBe(true);
  });

  it("keeps unacknowledged notices in Today until acknowledged", () => {
    const attendanceWindow = item("an-attendance-window");
    expect(inView(attendanceWindow, "today", DEMO_NOW)).toBe(true);
    expect(inView({ ...attendanceWindow, acknowledged: true }, "today", DEMO_NOW)).toBe(false);
  });

  it("leaves notices seen only through oversight out of Today", () => {
    expect(inView(item("an-rain-advisory", { addressed: false }), "today", DEMO_NOW)).toBe(false);
    expect(inView(item("an-rain-advisory", { addressed: false }), "mine", DEMO_NOW)).toBe(true);
  });

  it("routes exam and job categories to their views, and saved notices to Saved", () => {
    expect(inView(item("an-see-nov"), "exams", DEMO_NOW)).toBe(true);
    expect(inView(item("an-see-nov"), "jobs", DEMO_NOW)).toBe(false);
    expect(inView(item("an-internship-contoso"), "jobs", DEMO_NOW)).toBe(true);
    expect(inView(item("an-library"), "saved", DEMO_NOW)).toBe(false);
    expect(inView(item("an-library", { saved: true }), "saved", DEMO_NOW)).toBe(true);
  });
});
