import { describe, expect, it } from "vitest";
import {
  authorityAt,
  canApprove,
  canManageNotice,
  canMessageGuardiansOf,
} from "@/domains/announcements/guards";
import {
  audienceLabel,
  audienceUnit,
  canRemind,
  checkAttachment,
  publishRoute,
  safeFileName,
  type Authority,
} from "@/domains/announcements/rules";
import type { AudienceRule } from "@/domains/announcements/types";
import { suggestFollowUp } from "@/domains/messages/suggest";
import { render, TEMPLATES } from "@/domains/messages/templates";
import { deliverAt, inQuietHours } from "@/domains/notifications/quiet-hours";
import { outboxRows } from "@/domains/notifications/outbox";
import { ANNOUNCEMENTS } from "@/lib/demo/announcements";
import { guardianEmailFor, PARENT_PERSONA_EMAIL } from "@/lib/demo/communication";
import { STUDENTS } from "@/lib/demo/fixtures";
import { syntheticPdf } from "@/lib/demo/pdf";
import { ctxFor, demoTree, ref } from "../helpers/demo-authz";

const ist = (local: string) => new Date(`${local}+05:30`);
const all: Authority = { publish: true, approve: true, guardians: true };
const faculty: Authority = { publish: true, approve: false, guardians: false };
const incharge: Authority = { publish: true, approve: false, guardians: true };

const section = (audience: "students" | "families" | "guardians" = "students"): AudienceRule => ({
  kind: "section",
  sectionId: "CSE-3-A",
  audience,
});
const department: AudienceRule = { kind: "department", departmentCode: "CSE", audience: "students" };

describe("publishing policy (ADR-023)", () => {
  it("publishes section notices directly and sends broader ones from non-approvers for approval", () => {
    expect(publishRoute(section(), "normal", faculty)).toEqual({ kind: "direct" });
    expect(publishRoute(department, "normal", faculty)).toEqual({ kind: "approval" });
    expect(publishRoute(department, "normal", all)).toEqual({ kind: "direct" });
  });

  it("refuses targets outside the author's publishing scope", () => {
    expect(publishRoute(section(), "normal", { publish: false, approve: false, guardians: false }).kind).toBe(
      "denied",
    );
  });

  it("lets only those who may message guardians address them", () => {
    expect(publishRoute(section("families"), "normal", faculty).kind).toBe("denied");
    expect(publishRoute(section("guardians"), "normal", incharge)).toEqual({ kind: "direct" });
  });

  it("keeps critical notices with approvers", () => {
    expect(publishRoute(section(), "critical", incharge).kind).toBe("denied");
    expect(publishRoute(section(), "critical", all)).toEqual({ kind: "direct" });
  });

  it("anchors rules to the unit where publishing is authorized", () => {
    expect(audienceUnit({ kind: "institution", audience: "everyone" }, demoTree)?.code).toBe("DUG");
    expect(
      audienceUnit({ kind: "year", departmentCode: "CSE", year: 3, audience: "students" }, demoTree)?.code,
    ).toBe("CSE");
    expect(audienceUnit(section(), demoTree)?.code).toBe("CSE-3-A");
    expect(audienceLabel(section("families"), demoTree)).toBe("Section 3-CSE-A · Students & guardians");
  });
});

describe("communication guards against the seeded roles", () => {
  const at = (code: string) => demoTree.byCode.get(code)!.id;

  it("gives the faculty member publishing rights only in the sections they teach", () => {
    const rahul = ctxFor("faculty");
    expect(authorityAt(rahul, demoTree, at("CSE-3-A"))).toEqual({
      publish: true,
      approve: false,
      guardians: false,
    });
    expect(authorityAt(rahul, demoTree, at("CSE")).publish).toBe(false);
  });

  it("lets the class incharge message their section's guardians, and nobody else's", () => {
    const kavya = ctxFor("class_incharge");
    const own = STUDENTS.find((s) => s.sectionId === "CSE-3-A")!;
    const other = STUDENTS.find((s) => s.sectionId === "CSE-3-B")!;
    expect(canMessageGuardiansOf(kavya, demoTree, ref(own))).toBe(true);
    expect(canMessageGuardiansOf(kavya, demoTree, ref(other))).toBe(false);
    expect(canMessageGuardiansOf(ctxFor("faculty"), demoTree, ref(own))).toBe(false);
  });

  it("routes approval to approvers over the target, never the author", () => {
    const hod = ctxFor("hod_cse");
    const notice = { authorId: "someone-else", audienceUnitId: at("CSE") };
    expect(canApprove(hod, demoTree, notice)).toBe(true);
    expect(canApprove(hod, demoTree, { ...notice, authorId: hod.userId })).toBe(false);
    expect(canApprove(hod, demoTree, { ...notice, audienceUnitId: at("DUG") })).toBe(false);
    expect(canApprove(ctxFor("principal"), demoTree, { ...notice, audienceUnitId: at("DUG") })).toBe(true);
    expect(canApprove(ctxFor("exam_controller"), demoTree, notice)).toBe(false);
  });

  it("shows responses to the author and approvers only", () => {
    const notice = { authorId: "someone-else", audienceUnitId: at("CSE-3-A") };
    expect(canManageNotice(ctxFor("hod_cse"), demoTree, notice)).toBe(true);
    expect(canManageNotice(ctxFor("faculty"), demoTree, notice)).toBe(false);
    expect(canManageNotice(ctxFor("student"), demoTree, notice)).toBe(false);
  });

  it("seeds notices whose authors could have sent them", () => {
    for (const a of ANNOUNCEMENTS.filter((x) => x.authorKey)) {
      const unit = audienceUnit(a.audience, demoTree)!;
      const route = publishRoute(
        a.audience,
        a.severity,
        authorityAt(ctxFor(a.authorKey!), demoTree, unit.id),
      );
      expect(route.kind, a.id).not.toBe("denied");
      if (a.status === "pending") expect(route.kind, a.id).toBe("approval");
    }
  });
});

describe("quiet hours", () => {
  it("holds non-urgent messages from 21:00 until 07:00", () => {
    expect(inQuietHours(ist("2026-10-05T21:40:00"))).toBe(true);
    expect(inQuietHours(ist("2026-10-06T06:59:00"))).toBe(true);
    expect(inQuietHours(ist("2026-10-06T07:00:00"))).toBe(false);
    expect(deliverAt(ist("2026-10-05T21:40:00"), false)).toEqual(ist("2026-10-06T07:00:00"));
    expect(deliverAt(ist("2026-10-06T02:15:00"), false)).toEqual(ist("2026-10-06T07:00:00"));
    expect(deliverAt(ist("2026-10-06T09:30:00"), false)).toEqual(ist("2026-10-06T09:30:00"));
  });

  it("lets urgent messages through at night", () => {
    expect(deliverAt(ist("2026-10-05T23:00:00"), true)).toEqual(ist("2026-10-05T23:00:00"));
  });

  it("queues, holds or suppresses outbox rows", () => {
    const email = { recipientKind: "guardian" as const, toName: "G", subject: "s", body: "b" };
    const [day] = outboxRows(
      "t",
      { type: "guardian_message", id: "m" },
      [{ ...email, toAddress: "a@x" }],
      ist("2026-10-06T10:00:00"),
      false,
    );
    const [night] = outboxRows(
      "t",
      { type: "guardian_message", id: "m" },
      [{ ...email, toAddress: "a@x" }],
      ist("2026-10-06T22:00:00"),
      false,
    );
    const [none] = outboxRows(
      "t",
      { type: "guardian_message", id: "m" },
      [{ ...email, toAddress: null }],
      ist("2026-10-06T10:00:00"),
      false,
    );
    expect(day!.status).toBe("queued");
    expect(night!.status).toBe("held");
    expect(night!.notBefore).toEqual(ist("2026-10-07T07:00:00"));
    expect(none!.status).toBe("suppressed");
  });
});

describe("attachments", () => {
  const pdf = syntheticPdf("Timetable", ["line"]);

  it("accepts files whose bytes match their declared type", () => {
    expect(checkAttachment("t.pdf", "application/pdf", pdf)).toEqual({ ok: true });
  });

  it("refuses renamed, oversized, empty and unlisted files", () => {
    expect(checkAttachment("x.pdf", "application/pdf", new TextEncoder().encode("MZ executable")).ok).toBe(
      false,
    );
    expect(checkAttachment("x.pdf", "application/pdf", new Uint8Array(0)).ok).toBe(false);
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(pdf.slice(0, 4));
    expect(checkAttachment("x.pdf", "application/pdf", big).ok).toBe(false);
    expect(checkAttachment("x.html", "text/html", new TextEncoder().encode("<html>")).ok).toBe(false);
  });

  it("strips path and header characters from download names", () => {
    expect(safeFileName('../../etc/"passwd"\r\n.pdf')).toBe(".._.._etc__passwd___.pdf");
  });
});

describe("reminders", () => {
  it("go out at most once a day", () => {
    expect(canRemind(null, ist("2026-10-06T09:30:00"))).toBe(true);
    expect(canRemind(ist("2026-10-05T18:00:00").toISOString(), ist("2026-10-06T09:30:00"))).toBe(false);
    expect(canRemind(ist("2026-10-05T09:00:00").toISOString(), ist("2026-10-06T09:30:00"))).toBe(true);
  });
});

describe("guardian messages", () => {
  const now = ist("2026-10-06T09:30:00");

  it("renders each guardian's own figures and leaves unknown placeholders alone", () => {
    const text = render(TEMPLATES.attendance_shortage.subject + " {unknown}", {
      student: "Asha",
      roll: "24CSE001",
      section: "3-CSE-A",
      attendance: "68.2",
      threshold: "75",
      guardian: "Mr. Rao",
      sender: "Ms. Kavya Nair",
      institution: "Demo",
    });
    expect(text).toBe("Attendance below 75% — Asha {unknown}");
  });

  it("suggests a follow-up only below the requirement and not after recent contact", () => {
    const st = { attendancePct: 70, attendanceThreshold: 75, status: "active" };
    expect(suggestFollowUp({ ...st, attendancePct: 80 }, null, now)).toBeNull();
    expect(suggestFollowUp(st, null, now)?.template).toBe("attendance_shortage");
    expect(suggestFollowUp({ ...st, attendancePct: 60 }, null, now)?.template).toBe("exam_eligibility");
    expect(suggestFollowUp(st, ist("2026-09-30T16:30:00").toISOString(), now)).toBeNull();
    expect(suggestFollowUp(st, ist("2026-09-15T16:30:00").toISOString(), now)).not.toBeNull();
    expect(suggestFollowUp({ ...st, status: "detained" }, null, now)).toBeNull();
  });

  it("gives the parent persona's household the persona's address, and most others one", () => {
    const demo = STUDENTS.find((s) => s.sectionId === "CSE-3-A")!;
    expect(guardianEmailFor(demo.studentNumber)).toBe(PARENT_PERSONA_EMAIL);
    const withEmail = STUDENTS.filter((s) => guardianEmailFor(s.studentNumber)).length / STUDENTS.length;
    expect(withEmail).toBeGreaterThan(0.8);
    expect(withEmail).toBeLessThan(0.95);
  });
});
