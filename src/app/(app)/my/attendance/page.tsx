import type { Metadata } from "next";
import { WidgetCard } from "@/components/dashboard/widgets";
import { ApplyLeaveDialog } from "@/components/attendance/leave-form";
import { WithdrawButton } from "@/components/attendance/request-controls";
import { PageHeader } from "@/components/patterns/page-header";
import { PermissionState } from "@/components/patterns/states";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Meter } from "@/components/ui/misc";
import { addDays, weekdayName } from "@/domains/attendance/calendar";
import { projectAttendance } from "@/domains/attendance/projection";
import { studentAttendance } from "@/domains/attendance/repository";
import { LEAVE_AHEAD_DAYS, LEAVE_BACKDATE_DAYS } from "@/domains/attendance/rules";
import { linkedStudents, subjectsFor } from "@/domains/students/repository";
import { workspaceFor } from "@/lib/authz/catalogue";
import { requireAuth } from "@/lib/authz/context";
import { cn, formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "My attendance" };

const LEAVE_TONE: Record<string, BadgeTone> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  withdrawn: "neutral",
};

export default async function MyAttendancePage() {
  const authed = await requireAuth();
  const workspace = authed.ctx.active ? workspaceFor(authed.ctx.active.roleKey) : "operations";
  const relation = workspace === "guardian" ? "guardian" : "self";
  const [record] = await linkedStudents(authed, relation);
  const data = record ? await studentAttendance(authed, record) : null;
  if (!record || !data) {
    return (
      <>
        <PageHeader title="Attendance" />
        <PermissionState description="This page shows a student's own attendance. Your account is not linked to a student record." />
      </>
    );
  }
  const me = record.student;
  const threshold = me.attendanceThreshold;
  const subjects = (await subjectsFor(authed, record)).map((x) => ({
    ...x,
    ...projectAttendance(x.attended, x.held, threshold),
  }));
  const short = me.attendancePct < threshold;

  return (
    <>
      <PageHeader
        title={relation === "guardian" ? `${me.name}'s attendance` : "My attendance"}
        description={`${me.sectionLabel} · overall ${me.attendancePct.toFixed(1)}% · threshold ${threshold}%`}
        actions={
          data.canRequestLeave ? (
            <ApplyLeaveDialog
              studentId={me.id}
              studentName={me.name}
              min={addDays(data.now.date, -LEAVE_BACKDATE_DAYS)}
              max={addDays(data.now.date, LEAVE_AHEAD_DAYS)}
            />
          ) : undefined
        }
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <WidgetCard
            title="By subject"
            description={
              short
                ? `Below the ${threshold}% exam eligibility threshold — see what it takes to recover`
                : `Above the ${threshold}% threshold`
            }
            flush
          >
            <ul className="divide-border divide-y">
              {subjects.map((s) => {
                const below = s.held > 0 && s.pct < threshold;
                return (
                  <li key={s.courseCode} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="truncate text-sm font-medium">
                        {s.courseName}{" "}
                        <span className="text-2xs text-subtle font-mono font-normal">{s.courseCode}</span>
                      </p>
                      <span className={cn("tabular text-sm font-semibold", below && "text-danger")}>
                        {s.held ? `${s.pct.toFixed(1)}%` : "—"}
                      </span>
                    </div>
                    {s.held > 0 && (
                      <Meter
                        value={s.pct}
                        tone={below ? "danger" : s.canMiss <= 2 ? "warning" : "brand"}
                        label={`${s.courseName} attendance`}
                        className="mt-1.5"
                      />
                    )}
                    <p className={cn("mt-1 text-xs", below ? "text-danger" : "text-muted")}>
                      {s.held === 0
                        ? "No classes held yet"
                        : `${s.attended}/${s.held} attended${s.od ? ` (incl. ${s.od} on duty)` : ""}${s.excused ? ` · ${s.excused} excused (medical)` : ""} · ${
                            below
                              ? `attend the next ${s.mustAttend} classes to reach ${threshold}%`
                              : s.canMiss === 0
                                ? "no margin left"
                                : `can miss up to ${s.canMiss} more`
                          }`}
                    </p>
                  </li>
                );
              })}
            </ul>
          </WidgetCard>
          <WidgetCard title="Recent classes" description="Latest first, with how each counts" flush>
            <ul className="divide-border divide-y text-sm">
              {data.log.map((l, i) => {
                const label =
                  l.mark === "present"
                    ? "Present"
                    : l.leave === "od"
                      ? "On duty"
                      : l.leave === "medical"
                        ? "Excused"
                        : "Absent";
                const tone: BadgeTone = l.mark === "present" ? "success" : l.leave ? "info" : "danger";
                return (
                  <li key={`${l.date}-${l.startsAt}-${i}`} className="flex items-center gap-3 px-4 py-2">
                    <span className="w-28 shrink-0 text-xs">
                      {weekdayName(l.date).slice(0, 3)}, {formatDate(l.date)}
                      <span className="text-subtle block">{l.startsAt}</span>
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {l.courseName} <span className="text-2xs text-subtle font-mono">{l.courseCode}</span>
                    </span>
                    <Badge tone={tone}>{label}</Badge>
                  </li>
                );
              })}
            </ul>
          </WidgetCard>
        </div>
        <WidgetCard
          title="Leave applications"
          description="OD counts as present; approved medical leave is excused"
          flush
        >
          {data.leaves.length === 0 ? (
            <p className="text-muted px-4 py-8 text-center text-sm">No leave applied for this term.</p>
          ) : (
            <ul className="divide-border divide-y">
              {data.leaves.map((l) => (
                <li key={l.id} className="px-4 py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {l.kind === "od" ? "On duty" : "Medical"} ·{" "}
                        {l.fromDate === l.toDate
                          ? formatDate(l.fromDate)
                          : `${formatDate(l.fromDate)} – ${formatDate(l.toDate)}`}
                      </p>
                      <p className="text-muted text-xs">{l.reason}</p>
                      {l.decisionNote && <p className="text-muted mt-1 text-xs">Note: {l.decisionNote}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge tone={LEAVE_TONE[l.status]}>{l.status}</Badge>
                      {l.status === "pending" && l.mine && <WithdrawButton type="leave" id={l.id} />}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </WidgetCard>
      </div>
    </>
  );
}
