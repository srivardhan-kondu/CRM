import {
  AlertTriangle,
  BookOpen,
  Briefcase,
  ClipboardList,
  FileText,
  HeartHandshake,
  Inbox,
  Mail,
  Phone,
  ShieldCheck,
  UserRound,
  Wallet,
} from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DrillLink, NoticeList, WidgetCard } from "@/components/dashboard/widgets";
import { studentAcademics } from "@/domains/exams/repository";
import { PageHeader } from "@/components/patterns/page-header";
import { FeeBadge, RiskBadge, StudentStatusBadge } from "@/components/patterns/status";
import { Timeline } from "@/components/patterns/timeline";
import { ManageStudent } from "@/components/students/manage-student";
import { Student360Actions } from "@/components/students/student360-actions";
import { Badge } from "@/components/ui/badge";
import { Avatar, Meter } from "@/components/ui/misc";
import { GuardianMessageList } from "@/components/communication/messages";
import { noticesForStudent } from "@/domains/announcements/repository";
import { messagesForStudent } from "@/domains/messages/repository";
import { projectAttendance } from "@/domains/attendance/projection";
import { getStudentDetail } from "@/domains/students/repository";
import { transferTargets } from "@/domains/students/service";
import { workspaceFor } from "@/lib/authz/catalogue";
import { requireAuth } from "@/lib/authz/context";
import { authorize, holdsAnywhere } from "@/lib/authz/engine";
import { DEMO_NOW } from "@/lib/demo/fixtures";
import { cn, formatDate, formatINR } from "@/lib/utils";

export const metadata: Metadata = { title: "Student 360" };

const UPCOMING = [
  { icon: ClipboardList, label: "Assessment & results", phase: 4 },
  { icon: HeartHandshake, label: "Mentoring & interventions", phase: 6 },
  { icon: ShieldCheck, label: "Conduct & welfare", phase: 6 },
  { icon: Wallet, label: "Fee ledger & receipts", phase: 7 },
  { icon: FileText, label: "Documents & certificates", phase: 7 },
  { icon: Inbox, label: "Requests", phase: 7 },
  { icon: Briefcase, label: "Placements & internships", phase: 8 },
];

export default async function Student360Page({ params }: { params: Promise<{ id: string }> }) {
  const authed = await requireAuth();
  const { id } = await params;
  // Authorizes and audits the read. Unknown and out-of-scope IDs are indistinguishable: both 404.
  const detail = await getStudentDetail(authed, id);
  if (!detail) notFound();

  const { student: s, access: fields, timeline, placement } = detail;
  const section = authed.tree.byCode.get(s.sectionId);
  const canManage =
    !!section &&
    authorize(authed.ctx, authed.tree, "student:manage", {
      kind: "org_unit",
      tenantId: authed.ctx.tenantId,
      orgUnitId: section.id,
    }).allowed;
  const targets = canManage ? ((await transferTargets(authed, s.id)) ?? []) : [];
  // Course-only access (faculty): the subjects the viewer teaches, nothing cohort-wide.
  const teaching =
    fields.courseAttendance !== "all" && fields.courseAttendance.length > 0
      ? { courseCodes: fields.courseAttendance }
      : null;
  const isSelf = authed.ctx.links.some((l) => l.relation === "self" && l.studentNumber === s.studentNumber);
  const workspace = authed.ctx.active ? workspaceFor(authed.ctx.active.roleKey) : "operations";

  const threshold = s.attendanceThreshold;
  const subjects = detail.subjects.map((x) => ({
    ...x,
    ...projectAttendance(x.attended, x.held, threshold),
  }));
  const showSubjects = subjects.length > 0;
  const [notices, guardianMessages] = await Promise.all([
    noticesForStudent(authed, s).then((n) => n.slice(0, 4)),
    isSelf ? null : messagesForStudent(authed, s, fields.guardian),
  ]);
  const academics = fields.academic ? await studentAcademics(authed, { student: s, access: fields }) : null;

  return (
    <>
      <PageHeader
        title={isSelf ? "My profile" : "Student 360"}
        breadcrumbs={
          isSelf
            ? [{ label: "Home", href: "/dashboard" }, { label: "My profile" }]
            : [{ label: "Students", href: "/students" }, { label: s.name }]
        }
        className="mb-4"
      />

      {/* Persistent header: identity, placement in hierarchy, at-a-glance health, quick actions */}
      <section
        aria-label="Student summary"
        className="border-border bg-surface mb-5 rounded-lg border shadow-xs"
      >
        <div className="flex flex-col gap-4 p-5 md:flex-row md:items-start">
          <Avatar name={s.name} size="xl" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">{s.name}</h2>
              <StudentStatusBadge status={s.status} />
              {fields.risk && <RiskBadge level={s.risk.level} />}
            </div>
            <p className="text-muted mt-1 text-sm">
              <span className="text-foreground font-mono">{s.studentNumber}</span> · {s.programme} · Section{" "}
              {s.sectionLabel} · Semester {s.semester} · Batch {s.batch}
            </p>
            <p className="text-subtle mt-0.5 text-xs">
              Mentor: {s.mentorName} · Admitted {formatDate(s.admittedOn)}
              {s.hosteller ? " · Hostel resident" : " · Day scholar"}
            </p>
          </div>
          <div className="flex flex-col gap-2 md:items-end">
            <Student360Actions studentNumber={s.studentNumber} workspace={workspace} />
            {canManage && (
              <ManageStudent
                student={{
                  id: s.id,
                  name: s.name,
                  email: s.email,
                  phone: s.phone,
                  status: s.status,
                  hosteller: s.hosteller,
                  sectionLabel: s.sectionLabel,
                }}
                sections={targets}
              />
            )}
          </div>
        </div>

        <dl className="border-border grid grid-cols-2 border-t sm:grid-cols-3 lg:grid-cols-5">
          {fields.academic && (
            <>
              <Stat
                label="Attendance"
                value={`${s.attendancePct.toFixed(1)}%`}
                tone={s.attendancePct < threshold ? "danger" : undefined}
                hint={s.attendancePct < threshold ? `Below ${threshold}%` : "Above threshold"}
              />
              <Stat
                label="CGPA"
                value={s.cgpa > 0 ? s.cgpa.toFixed(2) : "—"}
                hint={s.cgpa > 0 ? `Through semester ${s.semester - 1}` : "First semester"}
              />
              <Stat
                label="Credits"
                value={`${s.creditsEarned}/${s.creditsRequired}`}
                hint={
                  <Meter
                    value={(s.creditsEarned / s.creditsRequired) * 100}
                    label="Credit progress"
                    className="mt-1"
                  />
                }
              />
              <Stat
                label="Backlogs"
                value={String(s.backlogs)}
                tone={s.backlogs >= 2 ? "danger" : undefined}
                hint={s.backlogs ? "Pending clearance" : "None"}
              />
            </>
          )}
          {fields.finance && (
            <Stat
              label="Fees"
              value={<FeeBadge status={s.feeStatus} />}
              hint={s.feeDue ? `${formatINR(s.feeDue)} outstanding` : "No dues"}
            />
          )}
          {!fields.academic && teaching && (
            <Stat
              label={`${teaching.courseCodes.join(", ")} attendance`}
              value={subjects[0] ? `${subjects[0].pct.toFixed(1)}%` : "—"}
              tone={subjects[0] && subjects[0].pct < threshold ? "danger" : undefined}
              hint="Your course only"
            />
          )}
        </dl>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          {fields.risk && s.risk.factors.length > 0 && (
            <WidgetCard
              title="Why this student is flagged"
              description="Each factor shows the rule it crossed. Risk is never a black box."
            >
              <ul className="grid gap-3 sm:grid-cols-2">
                {s.risk.factors.map((f) => (
                  <li key={f.key} className="border-warning/40 bg-warning-soft/40 rounded-md border p-3">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <AlertTriangle aria-hidden className="text-warning size-3.5" /> {f.label}
                    </p>
                    <p className="text-muted mt-0.5 text-xs">{f.detail}</p>
                    <p className="text-2xs text-subtle mt-1.5">
                      Rule: {f.threshold} · as of {formatDate(DEMO_NOW.toISOString())}
                    </p>
                  </li>
                ))}
              </ul>
            </WidgetCard>
          )}

          {showSubjects && (
            <WidgetCard
              title={teaching && !fields.academic ? "Attendance in your course" : "Attendance by subject"}
              description={`Term to date with projection against the ${threshold}% requirement`}
              action={
                isSelf || workspace === "guardian" ? (
                  <DrillLink href="/my/attendance">Register & leave</DrillLink>
                ) : undefined
              }
              flush
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-border text-2xs text-subtle border-b text-left tracking-wide uppercase">
                      <th className="px-4 py-2 font-medium">Subject</th>
                      <th className="px-3 py-2 text-right font-medium">Attended</th>
                      <th className="w-40 px-3 py-2 font-medium">
                        <span className="sr-only">Progress</span>
                      </th>
                      <th className="px-4 py-2 text-right font-medium">Projection</th>
                    </tr>
                  </thead>
                  <tbody className="divide-border divide-y">
                    {subjects.map((x) => {
                      const short = x.pct < threshold;
                      return (
                        <tr key={x.courseCode}>
                          <td className="px-4 py-2.5">
                            <div className="font-medium">{x.courseName}</div>
                            <div className="text-2xs text-subtle font-mono">{x.courseCode}</div>
                          </td>
                          <td className="tabular px-3 py-2.5 text-right">
                            <span className={cn("font-medium", short && "text-danger")}>
                              {x.pct.toFixed(1)}%
                            </span>
                            <div className="text-2xs text-subtle">
                              {x.attended}/{x.held}
                              {x.od > 0 && ` · ${x.od} OD`}
                              {x.excused > 0 && ` · ${x.excused} excused`}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <Meter
                              value={x.pct}
                              tone={short ? "danger" : x.canMiss <= 2 ? "warning" : "brand"}
                              label={`${x.courseName} attendance`}
                            />
                          </td>
                          <td
                            className={cn(
                              "px-4 py-2.5 text-right text-xs whitespace-nowrap",
                              short ? "text-danger" : "text-muted",
                            )}
                          >
                            {short
                              ? `Attend next ${x.mustAttend}`
                              : x.canMiss === 0
                                ? "No margin"
                                : `Can miss ${x.canMiss}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </WidgetCard>
          )}

          {academics && academics.semesters.length > 0 && (
            <WidgetCard
              title="Results by semester"
              description={`CGPA ${academics.standing.cgpa.toFixed(2)} · ${academics.standing.backlogs} backlogs · published results`}
              action={
                isSelf || workspace === "guardian" ? (
                  <DrillLink href="/my/academics">All grades</DrillLink>
                ) : undefined
              }
              flush
            >
              <ul className="divide-border divide-y text-sm">
                {academics.semesters.map((sem) => {
                  const failed = sem.results.filter(
                    (r) =>
                      r.outcome !== "pass" &&
                      !sem.results.some(
                        (x) => x.courseCode === r.courseCode && x.attempt > r.attempt && x.outcome === "pass",
                      ),
                  );
                  return (
                    <li key={sem.semester} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="w-24 shrink-0 font-medium">Semester {sem.semester}</span>
                      <span className="text-muted min-w-0 flex-1 truncate text-xs">
                        {sem.termName}
                        {failed.length > 0 && (
                          <span className="text-danger">
                            {" "}
                            · backlog: {failed.map((f) => f.courseCode).join(", ")}
                          </span>
                        )}
                      </span>
                      <span className="tabular font-semibold">{sem.sgpa.toFixed(2)}</span>
                    </li>
                  );
                })}
              </ul>
            </WidgetCard>
          )}

          <WidgetCard
            title="Programme & enrolment"
            description={`${placement.termName ?? "No current term"} · courses come from the batch's regulation`}
            flush
          >
            <dl className="border-border grid grid-cols-2 gap-x-4 gap-y-3 border-b px-4 py-3 text-sm sm:grid-cols-4">
              <Fact label="Programme" value={s.programme} hint={placement.programmeCode} />
              <Fact label="Regulation" value={placement.regulationCode} hint={placement.regulationName} />
              <Fact label="Batch" value={placement.batchName} hint={placement.batchCode} />
              <Fact label="Section" value={s.sectionLabel} hint={`Year ${s.year} · Semester ${s.semester}`} />
            </dl>
            {placement.courses.length === 0 ? (
              <p className="text-muted px-4 py-6 text-center text-sm">
                No offerings for this section in the current term yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-border text-2xs text-subtle border-b text-left tracking-wide uppercase">
                      <th className="px-4 py-2 font-medium">Course this term</th>
                      <th className="px-3 py-2 text-right font-medium">Credits</th>
                      <th className="px-4 py-2 font-medium">Taught by</th>
                    </tr>
                  </thead>
                  <tbody className="divide-border divide-y">
                    {placement.courses.map((c) => (
                      <tr key={c.offeringId}>
                        <td className="px-4 py-2">
                          <div className="font-medium">{c.name}</div>
                          <div className="text-2xs text-subtle font-mono">
                            {c.code}
                            {c.type !== "theory" && ` · ${c.type}`}
                          </div>
                        </td>
                        <td className="tabular px-3 py-2 text-right">{c.credits}</td>
                        <td className="px-4 py-2 text-xs">
                          {c.faculty.length ? (
                            c.faculty.join(", ")
                          ) : (
                            <Badge tone="warning">Unallocated</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {placement.history.length > 1 && (
              <div className="border-border border-t px-4 py-3">
                <p className="text-2xs text-subtle mb-1.5 font-medium tracking-wide uppercase">
                  Section history
                </p>
                <ul className="space-y-1 text-xs">
                  {placement.history.map((h) => (
                    <li key={h.id} className="flex flex-wrap gap-x-2">
                      <span className="font-medium">{h.sectionLabel}</span>
                      <span className="text-muted">
                        {formatDate(h.startedOn)} – {h.endedOn ? formatDate(h.endedOn) : "now"}
                      </span>
                      <span className="text-subtle">· {h.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </WidgetCard>

          <WidgetCard
            title="More of this record"
            description="These domains attach to the same student identity as they are delivered."
          >
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {UPCOMING.filter((u) => fields.finance || u.icon !== Wallet).map(
                ({ icon: Icon, label, phase }) => (
                  <li
                    key={label}
                    className="border-border-strong flex items-center gap-2.5 rounded-md border border-dashed px-3 py-2"
                  >
                    <Icon aria-hidden className="text-subtle size-4" />
                    <span className="text-muted text-sm">{label}</span>
                    <span className="text-2xs text-subtle ml-auto">Phase {phase}</span>
                  </li>
                ),
              )}
            </ul>
          </WidgetCard>
        </div>

        <div className="space-y-5">
          <WidgetCard title="Activity timeline" description="Changes, alerts and interactions — newest first">
            {timeline.length ? (
              <Timeline events={timeline} now={DEMO_NOW} />
            ) : (
              <p className="text-muted text-sm">No activity visible to your role.</p>
            )}
          </WidgetCard>

          {(fields.contact || fields.guardian) && (
            <WidgetCard title="Contact & guardian">
              <dl className="space-y-3 text-sm">
                {fields.contact && (
                  <>
                    <div className="flex items-center gap-2">
                      <Mail aria-hidden className="text-subtle size-4" />
                      <dt className="sr-only">Email</dt>
                      <dd className="truncate">{s.email}</dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <Phone aria-hidden className="text-subtle size-4" />
                      <dt className="sr-only">Phone</dt>
                      <dd className="tabular">{s.phone}</dd>
                    </div>
                  </>
                )}
                {fields.guardian &&
                  (placement.guardians.length
                    ? placement.guardians
                    : [{ ...s.guardian, isPrimary: true }]
                  ).map((g) => (
                    <div
                      key={`${g.name}-${g.relation}`}
                      className="border-border flex items-start gap-2 border-t pt-3"
                    >
                      <UserRound aria-hidden className="text-subtle mt-0.5 size-4" />
                      <div>
                        <dt className="text-2xs text-subtle">
                          {g.relation}
                          {g.isPrimary && placement.guardians.length > 1 && " · primary contact"}
                        </dt>
                        <dd className="font-medium">{g.name}</dd>
                        <dd className="text-muted tabular text-xs">{g.phone}</dd>
                      </div>
                    </div>
                  ))}
              </dl>
            </WidgetCard>
          )}

          {guardianMessages && (
            <WidgetCard
              title="Guardian communication"
              description="Messages to this student's guardians"
              action={
                holdsAnywhere(authed.ctx, "guardian:message") ? (
                  <DrillLink href={`/parent-communication?student=${s.id}`}>Message</DrillLink>
                ) : undefined
              }
              flush
            >
              <GuardianMessageList messages={guardianMessages} />
            </WidgetCard>
          )}
          <WidgetCard title={isSelf ? "Notices for you" : "Notices this student receives"} flush>
            <NoticeList items={notices} />
          </WidgetCard>

          {!isSelf && (
            <p className="text-2xs text-subtle flex items-center gap-1.5 px-1">
              <BookOpen aria-hidden className="size-3" /> Access to this record is scoped to your roles, and
              this view is recorded in the audit log.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "danger";
}) {
  return (
    <div className="border-border border-r border-b px-5 py-3 last:border-r-0">
      <dt className="text-2xs text-muted font-medium">{label}</dt>
      <dd className={cn("tabular mt-0.5 text-lg font-semibold", tone === "danger" && "text-danger")}>
        {value}
      </dd>
      {hint && <dd className="text-2xs text-subtle">{hint}</dd>}
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs text-muted font-medium">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
      {hint && <dd className="text-2xs text-subtle truncate">{hint}</dd>}
    </div>
  );
}
