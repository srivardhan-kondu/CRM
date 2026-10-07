import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WidgetCard } from "@/components/dashboard/widgets";
import { ActionButton } from "@/components/exams/entry-sheet";
import { PageHeader } from "@/components/patterns/page-header";
import { Badge } from "@/components/ui/badge";
import { publishAction } from "@/app/(app)/exams/actions";
import { weekdayName } from "@/domains/attendance/calendar";
import { examEvent } from "@/domains/exams/repository";
import { requireAuth } from "@/lib/authz/context";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Examination" };

export default async function ExamEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const authed = await requireAuth();
  const { eventId } = await params;
  const d = await examEvent(authed, eventId);
  if (!d) notFound();
  const { event } = d;

  return (
    <>
      <PageHeader
        title={event.name}
        description={`${event.kind === "regular" ? "Regular" : "Supplementary"} · ${formatDate(event.startsOn)} – ${formatDate(event.endsOn)} · ${d.courses.length} papers`}
        breadcrumbs={[{ label: "Examinations", href: "/exams" }, { label: event.code }]}
        actions={
          event.status === "published" ? (
            <Badge tone="success">Results published</Badge>
          ) : d.canManage ? (
            <ActionButton
              action={publishAction}
              hidden={{ eventId: event.id }}
              label="Publish results"
              disabled={d.blockers.length > 0}
            />
          ) : undefined
        }
      />
      {event.status !== "published" && (
        <div
          role="status"
          className={`mb-4 rounded-md px-3 py-2 text-sm ${d.blockers.length ? "bg-warning-soft text-warning-soft-foreground" : "bg-success-soft text-success-soft-foreground"}`}
        >
          {d.blockers.length ? (
            <>
              <span className="font-medium">Not ready to publish.</span> {d.blockers.join(" ")}
            </>
          ) : (
            "Every mark is in. Publishing grades every registration and opens revaluation for 7 days."
          )}
        </div>
      )}
      <WidgetCard title="Timetable and marks" description="One sitting per paper across sections" flush>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border text-2xs text-subtle border-b text-left tracking-wide uppercase">
                <th className="px-4 py-2 font-medium">Paper</th>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 text-right font-medium">Candidates</th>
                <th className="px-4 py-2 text-right font-medium">Marks entered</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {d.courses.map((c) => (
                <tr key={c.courseId} className="hover:bg-surface-muted">
                  <td className="px-4 py-2">
                    <Link href={`/exams/${event.id}/${c.courseId}`} className="hover:text-brand font-medium">
                      {c.courseCode}
                    </Link>
                    <div className="text-2xs text-subtle">{c.courseName}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {weekdayName(c.date).slice(0, 3)}, {formatDate(c.date)} ·{" "}
                    {c.session === "FN" ? "Forenoon" : "Afternoon"}
                  </td>
                  <td className="tabular px-3 py-2 text-right">{c.registrations}</td>
                  <td className="tabular px-4 py-2 text-right">
                    {c.date > d.today ? (
                      <span className="text-subtle text-xs">Not held yet</span>
                    ) : (
                      <span
                        className={
                          c.entered < c.registrations ? "text-warning-soft-foreground font-medium" : ""
                        }
                      >
                        {c.entered}/{c.registrations}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </WidgetCard>
    </>
  );
}
