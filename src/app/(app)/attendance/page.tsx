import { CalendarCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DrillLink, ScheduleList, WidgetCard } from "@/components/dashboard/widgets";
import {
  DeclareHolidayForm,
  InstitutionThresholdForm,
  ProgrammeThresholdForm,
} from "@/components/attendance/policy-controls";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState, PermissionState } from "@/components/patterns/states";
import { attendanceTone } from "@/components/patterns/status";
import { Badge } from "@/components/ui/badge";
import { listProgrammes } from "@/domains/academics/repository";
import { weekdayName } from "@/domains/attendance/calendar";
import { canDeclareHoliday, canSetInstitutionPolicy } from "@/domains/attendance/guards";
import {
  attendanceContext,
  attendanceOverview,
  classesOn,
  myOpenSessions,
} from "@/domains/attendance/repository";
import { requireAuth } from "@/lib/authz/context";
import { cn, formatDate, pluralize } from "@/lib/utils";

export const metadata: Metadata = { title: "Attendance" };

const TONE_TEXT = {
  success: "text-foreground",
  warning: "text-warning-soft-foreground",
  danger: "text-danger",
};

export default async function AttendancePage() {
  const authed = await requireAuth();
  const c = await attendanceContext(authed);
  if (!c) {
    return (
      <>
        <PageHeader title="Attendance" />
        <EmptyState
          icon={CalendarCheck}
          title="No current term"
          description="Set the current term in Academics first."
        />
      </>
    );
  }
  const [open, today, overview, programmes] = await Promise.all([
    myOpenSessions(authed),
    classesOn(authed, { mine: true }),
    attendanceOverview(authed),
    listProgrammes(authed),
  ]);
  const teaches =
    (today?.classes.length ?? 0) > 0 || (open?.overdue.length ?? 0) > 0 || (open?.awaiting.length ?? 0) > 0;
  const institutionPolicy = canSetInstitutionPolicy(authed.ctx, authed.tree);
  const editablePrograms = (programmes ?? []).filter((p) => p.manageable);
  const showPolicy = institutionPolicy || editablePrograms.length > 0 || !!overview;

  if (!teaches && !overview && !showPolicy) {
    return (
      <>
        <PageHeader title="Attendance" />
        <PermissionState description="Attendance is for teaching staff and those responsible for sections. Students see theirs under My Attendance." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Attendance"
        description={`${c.term.name} · ${weekdayName(c.now.date)}, ${formatDate(c.now.date)} · marking is open on the class's own day`}
      />
      <div className="space-y-5">
        {teaches && today && (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <WidgetCard
              title="My classes today"
              description={
                today.holiday ? `Holiday — ${today.holiday}` : `${today.classes.length} timetabled`
              }
              flush
            >
              <ScheduleList classes={today.classes} now={c.now.time} showSection />
            </WidgetCard>
            <WidgetCard
              title="Needs attention"
              description="Earlier classes you have not marked count for nobody until submitted"
              action={<DrillLink href="/tasks">All tasks</DrillLink>}
              flush
            >
              <ul className="divide-border divide-y text-sm">
                <li className="flex items-center justify-between px-4 py-3">
                  <span>Not marked, earlier days</span>
                  <Badge tone={open?.overdue.length ? "warning" : "success"}>
                    {open?.overdue.length ?? 0}
                  </Badge>
                </li>
                <li className="flex items-center justify-between px-4 py-3">
                  <span>Late submissions awaiting approval</span>
                  <Badge tone={open?.awaiting.length ? "info" : "neutral"}>
                    {open?.awaiting.length ?? 0}
                  </Badge>
                </li>
              </ul>
            </WidgetCard>
          </div>
        )}

        {overview && (
          <WidgetCard
            title="Sections"
            description="Lowest average first · marking = classes marked ÷ timetabled over the last 14 days"
            flush
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border text-2xs text-subtle border-b text-left tracking-wide uppercase">
                    <th className="px-4 py-2 font-medium">Section</th>
                    <th className="px-3 py-2 text-right font-medium">Students</th>
                    <th className="px-3 py-2 text-right font-medium">Average</th>
                    <th className="px-3 py-2 text-right font-medium">Below threshold</th>
                    <th className="px-4 py-2 text-right font-medium">Marking</th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {overview.map((r) => {
                    const pct =
                      r.compliance && r.compliance.expected
                        ? (r.compliance.marked / r.compliance.expected) * 100
                        : null;
                    return (
                      <tr key={r.sectionId} className="hover:bg-surface-muted">
                        <td className="px-4 py-2">
                          <Link
                            href={`/attendance/sections/${r.sectionCode}`}
                            className="hover:text-brand font-medium"
                          >
                            {r.sectionLabel}
                          </Link>
                          <div className="text-2xs text-subtle">
                            {r.departmentCode} · threshold {r.threshold}%
                          </div>
                        </td>
                        <td className="tabular px-3 py-2 text-right">{r.students}</td>
                        <td
                          className={cn(
                            "tabular px-3 py-2 text-right font-medium",
                            TONE_TEXT[attendanceTone(r.avgPct, r.threshold)],
                          )}
                        >
                          {r.avgPct.toFixed(1)}%
                        </td>
                        <td
                          className={cn(
                            "tabular px-3 py-2 text-right",
                            r.short > 0 && "text-danger font-medium",
                          )}
                        >
                          {r.short}
                        </td>
                        <td className="tabular px-4 py-2 text-right">
                          {pct === null ? (
                            "—"
                          ) : (
                            <span className={cn(pct < 95 && "text-warning-soft-foreground font-medium")}>
                              {pct.toFixed(0)}%
                              <span className="text-2xs text-subtle block font-normal">
                                {r.compliance!.marked}/{r.compliance!.expected}
                              </span>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </WidgetCard>
        )}

        {showPolicy && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <WidgetCard
              title="Shortage threshold"
              description={`Institution default ${c.thresholdPct}%; a programme may set its own.`}
            >
              <div className="space-y-4">
                {institutionPolicy && <InstitutionThresholdForm value={c.thresholdPct} />}
                <ul className="divide-border divide-y text-sm">
                  {(programmes ?? []).map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="font-medium">{p.name}</span>
                        <span className="text-2xs text-subtle block">
                          {p.attendanceThresholdPct === null
                            ? `Institution default (${c.thresholdPct}%)`
                            : `${p.attendanceThresholdPct}% (programme rule)`}
                        </span>
                      </span>
                      {p.manageable && (
                        <ProgrammeThresholdForm
                          programmeId={p.id}
                          code={p.code}
                          value={p.attendanceThresholdPct}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </WidgetCard>
            <WidgetCard
              title="Holidays"
              description={`${pluralize(c.holidays.length, "holiday")} this term; no classes are expected on them.`}
            >
              <div className="space-y-4">
                <ul className="divide-border divide-y text-sm">
                  {c.holidays.map((h) => (
                    <li key={h.id} className="flex justify-between gap-3 py-2">
                      <span>{h.name}</span>
                      <span className="text-muted tabular text-xs">
                        {weekdayName(h.date).slice(0, 3)}, {formatDate(h.date)}
                      </span>
                    </li>
                  ))}
                </ul>
                {canDeclareHoliday(authed.ctx, authed.tree) && (
                  <DeclareHolidayForm min={c.now.date} max={c.term.endsOn} />
                )}
              </div>
            </WidgetCard>
          </div>
        )}
      </div>
    </>
  );
}
