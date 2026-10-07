import { BookOpen, CalendarX, GraduationCap, HeartHandshake, Megaphone, Wallet } from "lucide-react";
import type { TimelineEvent } from "@/domains/students/types";
import { formatRelative } from "@/lib/utils";

const ICONS = {
  enrollment: GraduationCap,
  fee: Wallet,
  attendance: CalendarX,
  mentoring: HeartHandshake,
  academic: BookOpen,
  notice: Megaphone,
} as const;

const TONES: Record<TimelineEvent["kind"], string> = {
  enrollment: "bg-brand-soft text-brand-soft-foreground",
  fee: "bg-warning-soft text-warning-soft-foreground",
  attendance: "bg-danger-soft text-danger-soft-foreground",
  mentoring: "bg-success-soft text-success-soft-foreground",
  academic: "bg-info-soft text-info-soft-foreground",
  notice: "bg-surface-muted text-muted",
};

export function Timeline({ events, now }: { events: TimelineEvent[]; now: Date }) {
  return (
    <ol className="relative space-y-4">
      {events.map((e, i) => {
        const Icon = ICONS[e.kind];
        return (
          <li key={e.id} className="relative flex gap-3">
            {i < events.length - 1 && (
              <span aria-hidden className="bg-border absolute top-8 bottom-[-1rem] left-[13px] w-px" />
            )}
            <span
              className={`relative flex size-7 shrink-0 items-center justify-center rounded-full ${TONES[e.kind]}`}
            >
              <Icon aria-hidden className="size-3.5" />
            </span>
            <div className="min-w-0 pt-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <p className="text-foreground text-sm font-medium">{e.title}</p>
                <time dateTime={e.at} className="text-2xs text-subtle">
                  {formatRelative(e.at, now)}
                </time>
              </div>
              <p className="text-muted mt-0.5 text-xs">{e.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
