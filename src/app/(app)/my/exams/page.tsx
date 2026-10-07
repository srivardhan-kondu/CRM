import type { Metadata } from "next";
import { WidgetCard } from "@/components/dashboard/widgets";
import { PageHeader } from "@/components/patterns/page-header";
import { PermissionState } from "@/components/patterns/states";
import { Badge } from "@/components/ui/badge";
import { weekdayName } from "@/domains/attendance/calendar";
import { CONDONATION_BAND } from "@/domains/exams/rules";
import { studentExams } from "@/domains/exams/repository";
import { linkedStudents } from "@/domains/students/repository";
import { workspaceFor } from "@/lib/authz/catalogue";
import { requireAuth } from "@/lib/authz/context";
import { cn, formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "My exams" };

export default async function MyExamsPage() {
  const authed = await requireAuth();
  const workspace = authed.ctx.active ? workspaceFor(authed.ctx.active.roleKey) : "operations";
  const [record] = await linkedStudents(authed, workspace === "guardian" ? "guardian" : "self");
  const data = record ? await studentExams(authed, record) : null;
  if (!record || !data)
    return (
      <>
        <PageHeader title="Exams" />
        <PermissionState description="This page shows a student's own examinations. Your account is not linked to a student record." />
      </>
    );
  const me = record.student;
  const banner = data.maySit
    ? {
        tone: "bg-success-soft text-success-soft-foreground",
        text:
          data.eligibility === "eligible"
            ? `Eligible to sit: attendance ${me.attendancePct.toFixed(1)}% meets the ${me.attendanceThreshold}% requirement.`
            : "Eligible to sit: attendance shortage condoned.",
      }
    : data.eligibility === "condonable"
      ? {
          tone: "bg-warning-soft text-warning-soft-foreground",
          text: data.condonation
            ? `Attendance ${me.attendancePct.toFixed(1)}% is below ${me.attendanceThreshold}%. Your condonation request is ${data.condonation.status}.`
            : `Attendance ${me.attendancePct.toFixed(1)}% is below ${me.attendanceThreshold}%. Within ${CONDONATION_BAND} points, a condonation approved by the Controller of Examinations lets you sit — ask your class incharge.`,
        }
      : {
          tone: "bg-danger-soft text-danger-soft-foreground",
          text: `Attendance ${me.attendancePct.toFixed(1)}% is more than ${CONDONATION_BAND} points below ${me.attendanceThreshold}%: not eligible to sit this term's semester-end examinations.`,
        };

  return (
    <>
      <PageHeader
        title={workspace === "guardian" ? `${me.name}'s exams` : "My exams"}
        description={`${me.studentNumber} · ${me.sectionLabel}`}
      />
      <div role="status" className={cn("mb-5 rounded-md px-3 py-2 text-sm", banner.tone)}>
        {banner.text}
      </div>
      <div className="space-y-5">
        {data.sittings.map(({ event, papers }) => {
          const hallTicket = event.kind === "regular" && event.status !== "published";
          return (
            <WidgetCard
              key={event.id}
              title={event.name}
              description={
                event.status === "published"
                  ? "Results are published — see Academics"
                  : hallTicket
                    ? data.maySit
                      ? "Hall ticket: bring your college ID card to every paper"
                      : "Hall ticket withheld until eligibility is resolved"
                    : "Supplementary sitting for your backlogs"
              }
              action={
                <Badge tone={event.status === "published" ? "success" : "neutral"}>
                  {event.status === "published" ? "Published" : "Scheduled"}
                </Badge>
              }
              flush
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border text-2xs text-subtle border-b text-left tracking-wide uppercase">
                    <th className="px-4 py-2 font-medium">Paper</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Session</th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {papers.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-2">
                        <span className="font-medium">{p.courseName}</span>{" "}
                        <span className="text-2xs text-subtle font-mono">{p.courseCode}</span>
                        {event.kind === "supplementary" && (
                          <span className="text-2xs text-subtle block">
                            Semester {p.semester} · {data.termNames.get(p.termId)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {p.slot ? `${weekdayName(p.slot.date).slice(0, 3)}, ${formatDate(p.slot.date)}` : "—"}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {p.slot ? (p.slot.session === "FN" ? "10:00–13:00" : "14:00–17:00") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </WidgetCard>
          );
        })}
        {data.sittings.length === 0 && (
          <p className="text-muted text-sm">No examinations are scheduled for you yet.</p>
        )}
      </div>
    </>
  );
}
