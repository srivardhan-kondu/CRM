import { CalendarClock, Clock, Lock, MapPin } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WidgetCard } from "@/components/dashboard/widgets";
import { MarkForm } from "@/components/attendance/mark-form";
import { WithdrawButton } from "@/components/attendance/request-controls";
import { PageHeader } from "@/components/patterns/page-header";
import { Badge } from "@/components/ui/badge";
import { isClockTime, isIsoDate, weekdayName } from "@/domains/attendance/calendar";
import { sessionForMarking } from "@/domains/attendance/repository";
import { requireAuth } from "@/lib/authz/context";
import { cn, formatDate, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Mark attendance" };

const BANNER_TONE = {
  success: "bg-success-soft text-success-soft-foreground",
  neutral: "bg-surface-muted text-muted",
  info: "bg-info-soft text-info-soft-foreground",
  warning: "bg-warning-soft text-warning-soft-foreground",
} as const;

type Props = {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<{ date?: string; start?: string }>;
};

export default async function MarkAttendancePage({ params, searchParams }: Props) {
  const authed = await requireAuth();
  const { offeringId } = await params;
  const { date = "", start = "" } = await searchParams;
  if (!isIsoDate(date) || !isClockTime(start)) notFound();
  const s = await sessionForMarking(authed, offeringId, date, start);
  // Unknown class, no such meeting that day, or the viewer neither marks nor approves here: the same 404.
  if (!s) notFound();

  const { offering, recorded, window, pendingRequest } = s;
  const mode =
    !s.canMark || window === "upcoming" || (window === "closed" && pendingRequest)
      ? "readonly"
      : window === "open"
        ? "direct"
        : "request";

  const banner =
    window === "open"
      ? {
          icon: Clock,
          tone: "success" as const,
          text: recorded
            ? `Recorded by ${recorded.markedBy ?? "—"} at ${formatDateTime(recorded.markedAt.toISOString())}. You can change it until midnight today.`
            : "Marking is open until midnight today. Everyone starts as present — mark the absentees.",
        }
      : window === "upcoming"
        ? {
            icon: CalendarClock,
            tone: "neutral" as const,
            text: `Marking opens when the class starts at ${s.startsAt}.`,
          }
        : pendingRequest
          ? {
              icon: Lock,
              tone: "info" as const,
              text: `${pendingRequest.kind === "correction" ? "A correction" : "A late submission"} by ${pendingRequest.requestedBy} is waiting for approval. The marks below are what is recorded now.`,
            }
          : {
              icon: Lock,
              tone: "warning" as const,
              text: recorded
                ? "This class was on an earlier day. Changing it needs a correction, approved by your HOD."
                : "This class was never marked. Submit it late — it counts once your HOD approves it.",
            };

  return (
    <>
      <PageHeader
        title={`${offering.courseCode} · ${offering.courseName}`}
        description={`${offering.sectionLabel} · ${weekdayName(date)}, ${formatDate(date)} · ${s.startsAt}–${s.endsAt}`}
        breadcrumbs={[
          { label: "Attendance", href: "/attendance" },
          { label: `${offering.sectionLabel} ${offering.courseCode}` },
        ]}
        actions={
          recorded ? (
            <Badge tone={recorded.status === "held" ? "success" : "neutral"}>
              {recorded.status === "held" ? "Marked" : "Not held"}
            </Badge>
          ) : (
            <Badge tone={window === "closed" ? "warning" : "neutral"}>Not marked</Badge>
          )
        }
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <WidgetCard
          title={mode === "request" ? (recorded ? "Request a correction" : "Submit late") : "Roll"}
          description={`${s.roll.length} students on the roll that day`}
        >
          <div
            role="status"
            className={cn(
              "mb-4 flex items-start gap-2 rounded-md px-3 py-2 text-sm",
              BANNER_TONE[banner.tone],
            )}
          >
            <banner.icon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{banner.text}</span>
          </div>
          <MarkForm
            mode={mode}
            offeringId={offering.id}
            date={date}
            startsAt={s.startsAt}
            rows={s.roll}
            recordedStatus={recorded?.status ?? null}
            recordedCancelReason={recorded?.cancelReason ?? null}
          />
        </WidgetCard>
        <div className="space-y-5">
          <WidgetCard title="Class">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Teacher</dt>
                <dd className="text-right">
                  {offering.allocations.map((a) => a.name).join(", ") || "Not allocated"}
                </dd>
              </div>
              {s.room && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Room</dt>
                  <dd className="inline-flex items-center gap-1">
                    <MapPin aria-hidden className="size-3" /> {s.room}
                  </dd>
                </div>
              )}
              {recorded && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Recorded</dt>
                  <dd className="text-right">
                    {recorded.status === "held"
                      ? `${recorded.present} present · ${recorded.absent} absent`
                      : `Not held — ${recorded.cancelReason}`}
                  </dd>
                </div>
              )}
            </dl>
          </WidgetCard>
          {pendingRequest?.mine && (
            <WidgetCard
              title="Your request"
              description={`Sent ${formatDateTime(pendingRequest.requestedAt)}`}
            >
              <WithdrawButton type="attendance" id={pendingRequest.id} />
            </WidgetCard>
          )}
          <WidgetCard title="How attendance counts">
            <ul className="text-muted list-disc space-y-1 pl-4 text-xs">
              <li>Approved on-duty (OD) leave counts as present.</li>
              <li>Approved medical leave is excused: the class leaves the student&apos;s total.</li>
              <li>Changes after the day go to the HOD; nobody approves their own request.</li>
            </ul>
          </WidgetCard>
        </div>
      </div>
    </>
  );
}
