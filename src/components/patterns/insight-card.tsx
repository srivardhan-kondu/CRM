import { ArrowUpRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type InsightTone = "neutral" | "success" | "warning" | "danger";

/**
 * Insight card: metric + context + threshold + drill-down.
 * Every metric on a dashboard must explain itself (`definition`) and lead somewhere (`href`).
 */
export function InsightCard({
  label,
  value,
  context,
  definition,
  href,
  tone = "neutral",
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  context: ReactNode;
  definition: string;
  href?: string;
  tone?: InsightTone;
  icon: LucideIcon;
}) {
  const accents: Record<InsightTone, string> = {
    neutral: "text-muted bg-surface-muted",
    success: "text-success-soft-foreground bg-success-soft",
    warning: "text-warning-soft-foreground bg-warning-soft",
    danger: "text-danger-soft-foreground bg-danger-soft",
  };
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-muted text-xs font-medium">{label}</span>
        <span className={cn("flex size-7 items-center justify-center rounded-md", accents[tone])}>
          <Icon aria-hidden className="size-3.5" />
        </span>
      </div>
      <div className="tabular mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="text-muted mt-1 text-xs">{context}</div>
      <div className="border-border mt-3 flex items-center justify-between gap-2 border-t pt-2">
        <span className="text-2xs text-subtle truncate" title={definition}>
          {definition}
        </span>
        {href && (
          <ArrowUpRight
            aria-hidden
            className="text-subtle group-hover:text-brand size-3.5 shrink-0 transition-colors"
          />
        )}
      </div>
    </>
  );
  const base = "group block rounded-lg border border-border bg-surface p-4 shadow-xs";
  return href ? (
    <Link href={href} className={cn(base, "hover:border-border-strong transition-colors hover:shadow-sm")}>
      {body}
    </Link>
  ) : (
    <div className={base}>{body}</div>
  );
}
