import { ClipboardList } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { WidgetCard } from "@/components/dashboard/widgets";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState, PermissionState } from "@/components/patterns/states";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { ComponentRow } from "@/domains/exams/load";
import { assessmentWorkspace, type OfferingAssessment } from "@/domains/exams/repository";
import { requireAuth } from "@/lib/authz/context";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Internal marks" };

const STATUS_TONE: Record<ComponentRow["status"], BadgeTone> = {
  open: "neutral",
  submitted: "warning",
  approved: "success",
};
const STATUS_TEXT: Record<ComponentRow["status"], string> = {
  open: "Open",
  submitted: "With HOD",
  approved: "Approved",
};

function ComponentChips({ a }: { a: OfferingAssessment }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {a.components.map((c) => (
        <Badge key={c.id} tone={c.returnNote ? "danger" : STATUS_TONE[c.status]}>
          {c.label.replace("Internal assessment", "IA")}:{" "}
          {c.returnNote && c.status === "open" ? "Returned" : STATUS_TEXT[c.status]}
        </Badge>
      ))}
    </span>
  );
}

function OfferingTable({ list }: { list: OfferingAssessment[] }) {
  return (
    <ul className="divide-border divide-y text-sm">
      {list.map((a) => (
        <li key={a.offering.id}>
          <Link
            href={`/marks/${a.offering.id}`}
            className="hover:bg-surface-muted flex flex-wrap items-center gap-3 px-4 py-3"
          >
            <span className="min-w-0 flex-1">
              <span className="font-medium">
                {a.offering.courseCode} · {a.offering.courseName}
              </span>
              <span className="text-2xs text-subtle block">
                {a.offering.sectionLabel} ·{" "}
                {a.offering.allocations.map((x) => x.name).join(", ") || "No teacher"}
              </span>
            </span>
            <ComponentChips a={a} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function MarksPage() {
  const authed = await requireAuth();
  const w = await assessmentWorkspace(authed);
  if (!w)
    return (
      <EmptyState
        icon={ClipboardList}
        title="No current term"
        description="Set the current term in Academics first."
      />
    );
  if (w.mine.length === 0 && !w.moderator)
    return (
      <>
        <PageHeader title="Internal marks" />
        <PermissionState description="Internal marks are entered by the teachers of each course and moderated by the HOD." />
      </>
    );

  return (
    <>
      <PageHeader
        title="Internal marks"
        description={`${w.term.name} · enter and submit each component; the HOD approves it and the marks lock`}
      />
      <div className="space-y-5">
        {w.moderator && (
          <WidgetCard
            title="Waiting for your moderation"
            description={`${w.toModerate.length} submitted ${w.toModerate.length === 1 ? "component" : "components"}`}
            flush
          >
            {w.toModerate.length === 0 ? (
              <p className="text-muted px-4 py-8 text-center text-sm">Nothing is waiting for moderation.</p>
            ) : (
              <ul className="divide-border divide-y text-sm">
                {w.toModerate.map(({ component, offering }) => (
                  <li key={component.id}>
                    <Link
                      href={`/marks/${offering.id}?c=${component.key}`}
                      className="hover:bg-surface-muted flex flex-wrap items-center gap-3 px-4 py-3"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">
                          {component.label} — {offering.courseCode} · {offering.sectionLabel}
                        </span>
                        <span className="text-2xs text-subtle block">
                          {component.submittedBy} ·{" "}
                          {component.submittedAt ? formatDateTime(component.submittedAt.toISOString()) : ""}
                        </span>
                      </span>
                      <Badge tone="warning">Review</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </WidgetCard>
        )}
        {w.mine.length > 0 && (
          <WidgetCard title="My courses" description="Open a course to enter marks" flush>
            <OfferingTable list={w.mine} />
          </WidgetCard>
        )}
        {w.moderator && w.progress.length > 0 && (
          <WidgetCard
            title="Department progress"
            description="Every offering in the sections you moderate"
            flush
          >
            <OfferingTable list={w.progress} />
          </WidgetCard>
        )}
      </div>
    </>
  );
}
