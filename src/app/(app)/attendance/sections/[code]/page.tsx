import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WidgetCard } from "@/components/dashboard/widgets";
import { PageHeader } from "@/components/patterns/page-header";
import { attendanceTone } from "@/components/patterns/status";
import { Badge } from "@/components/ui/badge";
import { weekdayName } from "@/domains/attendance/calendar";
import { markHref } from "@/domains/attendance/links";
import { projectAttendance } from "@/domains/attendance/projection";
import { sectionReport } from "@/domains/attendance/repository";
import { requestCondonationAction } from "@/app/(app)/exams/actions";
import { RequestWithReason } from "@/components/exams/decide";
import { canRequestCondonationFor } from "@/domains/exams/guards";
import { eligibility } from "@/domains/exams/repository";
import { studentRef } from "@/domains/students/repository";
import { requireAuth } from "@/lib/authz/context";
import { cn, formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Section attendance" };

const TONE_CELL = {
  success: "",
  warning: "bg-warning-soft text-warning-soft-foreground",
  danger: "bg-danger-soft text-danger-soft-foreground font-medium",
};

export default async function SectionAttendancePage({ params }: { params: Promise<{ code: string }> }) {
  const authed = await requireAuth();
  const { code } = await params;
  const r = await sectionReport(authed, code);
  if (!r) notFound();

  const courses = r.offerings.map((o) => ({
    code: o.courseCode,
    name: o.courseName,
    teachers: o.allocations,
  }));
  const rows = r.students
    .map((v) => ({ v, subjects: r.subjects.get(v.student.id) ?? [] }))
    .sort((a, b) => a.v.student.attendancePct - b.v.student.attendancePct);
  const short = rows.filter((x) => x.v.student.attendancePct < x.v.student.attendanceThreshold);
  const label = r.students[0]?.student.sectionLabel ?? r.unit.name;
  const band = ((await eligibility(authed)) ?? []).filter(
    (e) => e.student.sectionId === code && e.eligibility !== "eligible",
  );

  return (
    <>
      <PageHeader
        title={`${label} attendance`}
        description={`${rows.length} students · ${r.held} classes held, ${r.cancelled} not held this term · ${short.length} below threshold`}
        breadcrumbs={[{ label: "Attendance", href: "/attendance" }, { label }]}
      />
      <div className="space-y-5">
        <WidgetCard
          title="Students × courses"
          description="Lowest overall first. Cells show attended ÷ held; amber is below threshold, red under 65%."
          flush
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border text-2xs text-subtle border-b text-left tracking-wide uppercase">
                  <th className="bg-surface sticky left-0 px-4 py-2 font-medium">Student</th>
                  <th className="px-3 py-2 text-right font-medium">Overall</th>
                  {courses.map((c) => (
                    <th key={c.code} className="px-3 py-2 text-right font-medium" title={c.name}>
                      {c.code}
                    </th>
                  ))}
                  <th className="px-4 py-2 text-right font-medium">To recover</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {rows.map(({ v, subjects }) => {
                  const s = v.student;
                  const totals = subjects.reduce((n, x) => ({ a: n.a + x.attended, h: n.h + x.held }), {
                    a: 0,
                    h: 0,
                  });
                  const proj = projectAttendance(totals.a, totals.h, s.attendanceThreshold);
                  return (
                    <tr key={s.id} className="hover:bg-surface-muted">
                      <td className="bg-surface sticky left-0 px-4 py-2">
                        <Link href={`/students/${s.id}`} className="hover:text-brand font-medium">
                          {s.name}
                        </Link>
                        <div className="text-2xs text-subtle font-mono">{s.studentNumber}</div>
                      </td>
                      <td
                        className={cn(
                          "tabular px-3 py-2 text-right",
                          TONE_CELL[attendanceTone(s.attendancePct, s.attendanceThreshold)],
                        )}
                      >
                        {s.attendancePct.toFixed(1)}%
                      </td>
                      {courses.map((c) => {
                        const x = subjects.find((y) => y.courseCode === c.code);
                        if (!x || x.held === 0)
                          return (
                            <td key={c.code} className="text-subtle px-3 py-2 text-right">
                              —
                            </td>
                          );
                        const pct = (x.attended / x.held) * 100;
                        return (
                          <td
                            key={c.code}
                            className={cn(
                              "tabular px-3 py-2 text-right text-xs",
                              TONE_CELL[attendanceTone(pct, s.attendanceThreshold)],
                            )}
                          >
                            {pct.toFixed(0)}%
                            <span className="text-2xs block opacity-70">
                              {x.attended}/{x.held}
                            </span>
                          </td>
                        );
                      })}
                      <td className="text-muted px-4 py-2 text-right text-xs whitespace-nowrap">
                        {proj.mustAttend > 0 ? `Attend next ${proj.mustAttend}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </WidgetCard>

        {band.length > 0 && (
          <WidgetCard
            title="Examination eligibility"
            description="Students below their threshold. Within 10 points, a condonation approved by the Controller of Examinations lets them sit."
            flush
          >
            <ul className="divide-border divide-y text-sm">
              {band.map((e) => (
                <li key={e.student.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <Link href={`/students/${e.student.id}`} className="hover:text-brand font-medium">
                      {e.student.name}
                    </Link>{" "}
                    <span className="text-2xs text-subtle font-mono">{e.student.studentNumber}</span>
                    <span className="text-muted block text-xs">
                      {e.student.attendancePct.toFixed(1)}% · threshold {e.student.attendanceThreshold}%
                    </span>
                  </span>
                  {e.eligibility === "not_eligible" ? (
                    <Badge tone="danger">Not eligible</Badge>
                  ) : e.condonation ? (
                    <Badge tone={e.condonation.status === "approved" ? "success" : "warning"}>
                      Condonation {e.condonation.status}
                    </Badge>
                  ) : canRequestCondonationFor(
                      authed.ctx,
                      authed.tree,
                      studentRef(e.student, authed.ctx.tenantId),
                    ) ? (
                    <RequestWithReason
                      action={requestCondonationAction}
                      hidden={{ studentId: e.student.id }}
                      trigger="Request condonation"
                      title={`Condonation for ${e.student.name}`}
                      description="The Controller of Examinations decides. Attach the reason the student fell short."
                    />
                  ) : (
                    <Badge tone="warning">Condonation band</Badge>
                  )}
                </li>
              ))}
            </ul>
          </WidgetCard>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <WidgetCard
            title="Classes not marked"
            description="Timetabled before today with no record — the teacher submits them late for approval"
            flush
          >
            {r.gaps.length === 0 ? (
              <p className="text-muted px-4 py-8 text-center text-sm">
                Every timetabled class has been recorded.
              </p>
            ) : (
              <ul className="divide-border divide-y text-sm">
                {r.gaps.map((g) => (
                  <li key={g.key} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-28 shrink-0 text-xs">
                      {weekdayName(g.date).slice(0, 3)}, {formatDate(g.date)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {g.courseCode} · {g.startsAt}
                      <span className="text-2xs text-subtle block truncate">{g.teachers.join(", ")}</span>
                    </span>
                    {g.pendingRequestId ? (
                      <Badge tone="info">Awaiting approval</Badge>
                    ) : (
                      <Badge tone="warning">Not marked</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </WidgetCard>
          <WidgetCard title="Recent register" description="The latest recorded classes" flush>
            <ul className="divide-border divide-y text-sm">
              {r.sessions.map((x) => (
                <li key={x.id}>
                  <Link
                    href={markHref({ offeringId: x.offeringId, date: x.date, startsAt: x.startsAt })}
                    className="hover:bg-surface-muted flex items-center gap-3 px-4 py-2.5"
                  >
                    <span className="w-28 shrink-0 text-xs">
                      {weekdayName(x.date).slice(0, 3)}, {formatDate(x.date)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {x.offering.courseCode} · {x.startsAt}
                      <span className="text-2xs text-subtle block truncate">{x.markedBy ?? "—"}</span>
                    </span>
                    <span className="text-muted text-xs">
                      {x.status === "held" ? `${x.present}/${x.present + x.absent} present` : "Not held"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </WidgetCard>
        </div>
      </div>
    </>
  );
}
