import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WidgetCard } from "@/components/dashboard/widgets";
import { PageHeader } from "@/components/patterns/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StudentStatusBadge } from "@/components/patterns/status";
import { Meter } from "@/components/ui/misc";
import { getOffering, termContext } from "@/domains/academics/repository";
import { weekdayName, WEEKDAY_NAMES } from "@/domains/attendance/calendar";
import { markHref } from "@/domains/attendance/links";
import { projectAttendance } from "@/domains/attendance/projection";
import { offeringRegister } from "@/domains/attendance/repository";
import { subjectsFor, visibleStudents } from "@/domains/students/repository";
import { requireAuth } from "@/lib/authz/context";
import { cn, formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Course roster" };

type Props = { params: Promise<{ offeringId: string }>; searchParams: Promise<{ term?: string }> };

export default async function CourseRosterPage({ params, searchParams }: Props) {
  const authed = await requireAuth();
  const { offeringId } = await params;
  const { term: code } = await searchParams;
  const { term } = await termContext(authed, code);
  const offering = term ? await getOffering(authed, term.id, offeringId) : null;
  // Only the faculty allocated to the offering open its roster here; anyone else gets the same 404 as a bad id.
  if (!offering || !offering.allocations.some((a) => a.userId === authed.ctx.userId)) notFound();

  const roster = (await visibleStudents(authed)).filter((v) => v.student.sectionId === offering.sectionCode);
  // Attendance is recorded for the current term; earlier terms show the roster only.
  const rows = await Promise.all(
    roster.map(async (v) => {
      const subj = term?.isCurrent
        ? (await subjectsFor(authed, v)).find((x) => x.courseCode === offering.courseCode)
        : undefined;
      return {
        v,
        subj,
        proj: subj ? projectAttendance(subj.attended, subj.held, v.student.attendanceThreshold) : null,
      };
    }),
  );
  rows.sort(
    (a, b) =>
      (a.proj?.pct ?? 101) - (b.proj?.pct ?? 101) ||
      a.v.student.studentNumber.localeCompare(b.v.student.studentNumber),
  );
  const short = rows.filter((r) => r.proj && r.proj.pct < r.v.student.attendanceThreshold).length;
  const register = term?.isCurrent ? await offeringRegister(authed, offering.id) : null;
  const markNow = register?.unmarked.find((o) => o.window === "open") ?? null;

  return (
    <>
      <PageHeader
        title={`${offering.courseCode} · ${offering.courseName}`}
        description={`Section ${offering.sectionLabel} · ${roster.length} students · ${term?.name}`}
        breadcrumbs={[
          { label: "My Courses", href: "/my/courses" },
          { label: `${offering.courseCode} ${offering.sectionLabel}` },
        ]}
        actions={
          markNow ? (
            <Button asChild>
              <Link href={markHref(markNow)}>Mark today&apos;s {markNow.startsAt} class</Link>
            </Button>
          ) : undefined
        }
      />
      <WidgetCard
        title="Roster"
        description={
          term?.isCurrent
            ? `Lowest ${offering.courseCode} attendance first · ${short} below threshold`
            : "Attendance is shown for the current term only."
        }
        flush
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border text-2xs text-subtle border-b text-left tracking-wide uppercase">
                <th className="px-4 py-2 font-medium">Student</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Attended</th>
                <th className="w-40 px-3 py-2 font-medium">
                  <span className="sr-only">Progress</span>
                </th>
                <th className="px-4 py-2 text-right font-medium">Projection</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {rows.map(({ v, subj, proj }) => {
                const isShort = !!proj && proj.pct < v.student.attendanceThreshold;
                return (
                  <tr key={v.student.id} className="hover:bg-surface-muted">
                    <td className="px-4 py-2">
                      <Link href={`/students/${v.student.id}`} className="hover:text-brand font-medium">
                        {v.student.name}
                      </Link>
                      <div className="text-2xs text-subtle font-mono">{v.student.studentNumber}</div>
                    </td>
                    <td className="px-3 py-2">
                      <StudentStatusBadge status={v.student.status} />
                    </td>
                    <td className="tabular px-3 py-2 text-right">
                      {subj && proj ? (
                        <>
                          <span className={cn("font-medium", isShort && "text-danger")}>
                            {proj.pct.toFixed(1)}%
                          </span>
                          <div className="text-2xs text-subtle">
                            {subj.attended}/{subj.held}
                          </div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {proj && (
                        <Meter
                          value={proj.pct}
                          tone={isShort ? "danger" : proj.canMiss <= 2 ? "warning" : "brand"}
                          label={`${v.student.name} attendance`}
                        />
                      )}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-2 text-right text-xs whitespace-nowrap",
                        isShort ? "text-danger" : "text-muted",
                      )}
                    >
                      {!proj
                        ? "—"
                        : isShort
                          ? `Attend next ${proj.mustAttend}`
                          : proj.canMiss === 0
                            ? "No margin"
                            : `Can miss ${proj.canMiss}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </WidgetCard>
      {register && (
        <WidgetCard
          title="Register"
          description={`Weekly: ${
            register.weekly
              .map((w) => `${WEEKDAY_NAMES[w.weekday - 1]!.slice(0, 3)} ${w.startsAt}`)
              .join(", ") || "not timetabled"
          } · same-day marking; later changes need HOD approval`}
          className="mt-5"
          flush
        >
          <ul className="divide-border divide-y">
            {register.unmarked.map((o) => (
              <li key={o.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-40 shrink-0">
                  {weekdayName(o.date).slice(0, 3)}, {formatDate(o.date)} · {o.startsAt}
                </span>
                <span className="flex-1">
                  {o.pendingRequestId ? (
                    <Badge tone="info">Late submission awaiting approval</Badge>
                  ) : (
                    <Badge tone="warning">Not marked</Badge>
                  )}
                </span>
                {register.canMark && !o.pendingRequestId && (
                  <Link href={markHref(o)} className="text-brand text-xs font-medium hover:underline">
                    {o.window === "open" ? "Mark" : "Submit late"}
                  </Link>
                )}
              </li>
            ))}
            {register.sessions.slice(0, 25).map((x) => (
              <li key={x.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-40 shrink-0">
                  {weekdayName(x.date).slice(0, 3)}, {formatDate(x.date)} · {x.startsAt}
                </span>
                <span className="text-muted flex-1 text-xs">
                  {x.status === "held"
                    ? `${x.present} present · ${x.absent} absent`
                    : `Not held — ${x.cancelReason}`}
                  {x.markedBy && ` · by ${x.markedBy}`}
                </span>
                {register.canMark && (
                  <Link
                    href={markHref({ offeringId: offering.id, date: x.date, startsAt: x.startsAt })}
                    className="text-brand text-xs font-medium hover:underline"
                  >
                    {x.date === register.now.date ? "Edit" : "Correct"}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </WidgetCard>
      )}
    </>
  );
}
