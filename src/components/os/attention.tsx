import { AlertOctagon, ArrowRight, CircleAlert, Info, ListChecks, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { PRIORITY_LABEL, type AttentionItem, type Priority } from "@/domains/insights/attention";
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";

/*
 * Attention components. Priority is always shown as an icon and a word as well as a colour, so it survives
 * colour-blindness, greyscale printing and screen readers.
 */

const PRIORITY_STYLE: Record<Priority, { icon: LucideIcon; stripe: string; text: string; soft: string }> = {
  critical: { icon: AlertOctagon, stripe: "bg-danger", text: "text-danger", soft: "bg-danger-soft" },
  action: { icon: ListChecks, stripe: "bg-brand", text: "text-brand", soft: "bg-brand-soft" },
  important: {
    icon: CircleAlert,
    stripe: "bg-warning",
    text: "text-warning-soft-foreground",
    soft: "bg-warning-soft",
  },
  info: { icon: Info, stripe: "bg-info", text: "text-info-soft-foreground", soft: "bg-info-soft" },
};

export function PriorityTag({ priority }: { priority: Priority }) {
  const s = PRIORITY_STYLE[priority];
  const Icon = s.icon;
  return (
    <span
      className={cn("text-2xs inline-flex items-center gap-1 font-semibold tracking-wide uppercase", s.text)}
    >
      <Icon aria-hidden className="size-3.5" />
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const s = PRIORITY_STYLE[item.priority];
  return (
    <li>
      <Link
        href={item.href}
        className="group hover:bg-surface-muted relative flex items-start gap-4 py-3.5 pr-4 pl-5 transition-colors"
      >
        <span aria-hidden className={cn("absolute inset-y-3 left-0 w-[3px] rounded-r", s.stripe)} />
        <div className="min-w-0 flex-1">
          <PriorityTag priority={item.priority} />
          <p className="text-foreground mt-1 text-[15px] leading-snug font-medium">{item.title}</p>
          <p className="text-muted mt-0.5 line-clamp-2 text-sm">{item.detail}</p>
        </div>
        <span className="text-brand mt-5 inline-flex shrink-0 items-center gap-1 text-sm font-medium whitespace-nowrap">
          {item.cta}
          <ArrowRight aria-hidden className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    </li>
  );
}

/**
 * The primary attention block: critical issues and actions first, then what is important. Shows at most `limit`
 * items and says how many more there are, so it never becomes a wall.
 */
export function AttentionCard({
  items,
  title = "Needs attention",
  limit = 5,
  emptyTitle = "Nothing needs your attention",
  emptyDescription = "No critical issues or pending actions in your scope right now.",
}: {
  items: AttentionItem[];
  title?: string;
  limit?: number;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const shown = items.filter((i) => i.priority !== "info").slice(0, limit);
  const critical = items.filter((i) => i.priority === "critical").length;
  return (
    <section aria-labelledby="attention-title" className="border-border bg-surface rounded-lg border">
      <header className="border-border flex items-baseline justify-between gap-3 border-b px-5 py-3.5">
        <h2 id="attention-title" className="text-foreground text-base font-semibold">
          {title}
        </h2>
        <p className="text-muted text-xs">
          {critical > 0 ? (
            <span className="text-danger font-medium">{critical} critical</span>
          ) : (
            "No critical issues"
          )}
          {shown.length > 0 && ` · ${items.length} in total`}
        </p>
      </header>
      {shown.length === 0 ? (
        <EmptyState tone="success" title={emptyTitle} description={emptyDescription} compact />
      ) : (
        <ul className="divide-border divide-y">
          {shown.map((i) => (
            <AttentionRow key={i.id} item={i} />
          ))}
        </ul>
      )}
    </section>
  );
}

export interface WorkItem {
  id: string;
  title: string;
  meta: string;
  href: string;
  state?: { label: string; tone: "critical" | "warning" | "neutral" | "success" };
  action?: ReactNode;
}

/** A list of concrete tasks (classes to mark, approvals, papers): one line each, with state and a direct action. */
export function WorkQueue({
  title,
  description,
  items,
  href,
  empty,
}: {
  title: string;
  description?: string;
  items: WorkItem[];
  href?: string;
  empty: { title: string; description: string };
}) {
  const tone = {
    critical: "text-danger",
    warning: "text-warning-soft-foreground",
    neutral: "text-muted",
    success: "text-success-soft-foreground",
  } as const;
  return (
    <section className="border-border bg-surface rounded-lg border">
      <header className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-2">
        <div>
          <h2 className="text-foreground text-sm font-semibold">{title}</h2>
          {description && <p className="text-muted text-xs">{description}</p>}
        </div>
        {href && (
          <Link href={href} className="text-brand text-xs font-medium hover:underline">
            View all
          </Link>
        )}
      </header>
      {items.length === 0 ? (
        <EmptyState title={empty.title} description={empty.description} compact />
      ) : (
        <ul className="divide-border divide-y pb-1">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-5 py-2.5">
              <Link href={i.href} className="hover:text-brand min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{i.title}</p>
                <p className="text-subtle truncate text-xs">{i.meta}</p>
              </Link>
              {i.state && (
                <span className={cn("shrink-0 text-xs font-medium", tone[i.state.tone])}>
                  {i.state.label}
                </span>
              )}
              {i.action}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Action items as compact tiles, for the "Action required" row under the attention block. */
export function ActionRequired({ items }: { items: AttentionItem[] }) {
  const actions = items.filter((i) => i.priority === "action");
  if (actions.length === 0) return null;
  return (
    <section aria-label="Action required">
      <h2 className="text-muted mb-2 text-xs font-semibold tracking-wide uppercase">Action required</h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {actions.map((i) => (
          <li key={i.id}>
            <Link
              href={i.href}
              className="border-border bg-surface hover:border-brand/40 group flex h-full items-center gap-3 rounded-lg border px-4 py-3 transition-colors"
            >
              {i.count !== undefined && (
                <span className="bg-brand-soft text-brand-soft-foreground tabular flex size-9 shrink-0 items-center justify-center rounded-md text-sm font-semibold">
                  {i.count}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="text-foreground block truncate text-sm font-medium">{i.title}</span>
                <span className="text-brand text-xs font-medium">{i.cta} →</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
