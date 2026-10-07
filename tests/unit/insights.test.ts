import { describe, expect, it } from "vitest";
import { parseIntent } from "@/domains/assistant/intents";
import { campusPulse, rankAttention, trendSummary, type AttentionItem } from "@/domains/insights/attention";
import { summarizeStudent } from "@/domains/students/summary";
import { STUDENTS } from "@/lib/demo/fixtures";
import { ctxFor, demoTree, ref } from "../helpers/demo-authz";
import { studentFieldAccess } from "@/lib/authz/engine";

describe("natural-language questions (rule-based)", () => {
  it("understands the example queries", () => {
    expect(parseIntent("students below 75% attendance")).toEqual({ kind: "attendance_below", threshold: 75 });
    expect(parseIntent("pending approvals")).toEqual({ kind: "pending_approvals" });
    expect(parseIntent("external exam notices")).toEqual({ kind: "exams_upcoming", external: true });
    expect(parseIntent("students with multiple backlogs")).toEqual({ kind: "backlogs", min: 2 });
    expect(parseIntent("Which students need intervention?")).toEqual({ kind: "intervention" });
    expect(parseIntent("Which sections are below attendance threshold?")).toEqual({ kind: "sections_below" });
    expect(parseIntent("What exams are coming up?")).toEqual({ kind: "exams_upcoming", external: false });
    expect(parseIntent("Summarize today's important announcements")).toEqual({ kind: "announcements_today" });
  });

  it("treats shortage without a number as the programme's own requirement", () => {
    expect(parseIntent("attendance shortage")).toEqual({ kind: "attendance_below", threshold: null });
  });

  it("does not match SEE inside other words, and returns null for anything it can't answer", () => {
    expect(parseIntent("who has seen the notice")).toBeNull();
    expect(parseIntent("weather tomorrow")).toBeNull();
    expect(parseIntent("hi")).toBeNull();
  });
});

describe("attention model", () => {
  const item = (id: string, priority: AttentionItem["priority"], count?: number): AttentionItem => ({
    id,
    priority,
    title: id,
    detail: "",
    href: "/",
    cta: "Go",
    count,
  });

  it("puts critical first, then actions, then important, then information; larger counts first", () => {
    const ranked = rankAttention([
      item("i", "info"),
      item("a1", "action", 2),
      item("c", "critical"),
      item("a2", "action", 9),
      item("m", "important"),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["c", "a2", "a1", "m", "i"]);
  });

  const base = {
    scopeName: "The campus",
    students: 400,
    avgAttendance: 84,
    threshold: 75,
    shortage: 10,
    notEligible: 2,
    highRisk: 5,
    approvalsPending: 2,
    approvalsOverdue: 0,
    attendanceDelta: 0.4,
  };

  it("reports good health when every vital is within its threshold", () => {
    const p = campusPulse(base);
    expect(p.status).toBe("good");
    expect(p.headline).toBe("The campus is in good health.");
  });

  it("is critical when approvals pass the SLA or >2% of students are ineligible, and says why", () => {
    expect(campusPulse({ ...base, approvalsOverdue: 1 }).status).toBe("critical");
    const p = campusPulse({ ...base, notEligible: 12 });
    expect(p.status).toBe("critical");
    expect(p.headline).toMatch(/needs attention: .*12 past the condonation band/);
  });

  it("watches attendance within 5 points of the requirement", () => {
    const p = campusPulse({ ...base, avgAttendance: 78 });
    expect(p.status).toBe("watch");
    expect(p.vitals.find((v) => v.key === "attendance")?.status).toBe("watch");
  });

  it("summarizes a trend as the latest value and change on the previous point", () => {
    expect(trendSummary([{ value: 80 }, { value: 82.5 }])).toEqual({ current: 82.5, delta: 2.5 });
    expect(trendSummary([])).toEqual({ current: null, delta: null });
  });
});

describe("Student 360 summary", () => {
  const s = STUDENTS.find((x) => x.sectionId === "CSE-3-A" && x.attendancePct < x.attendanceThreshold)!;

  it("writes attendance, results and risk for a viewer with full academic access", () => {
    const access = studentFieldAccess(ctxFor("class_incharge"), demoTree, ref(s));
    const text = summarizeStudent(s, access)
      .map((l) => l.text)
      .join(" ");
    expect(text).toContain(`${s.attendancePct.toFixed(1)}%`);
    expect(text).toMatch(/requirement|condonation/);
  });

  it("says nothing about attendance, results or risk to a viewer without those fields", () => {
    const access = studentFieldAccess(ctxFor("faculty"), demoTree, ref(s));
    const lines = summarizeStudent(s, access);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).not.toMatch(/%|CGPA|risk/);
  });
});
