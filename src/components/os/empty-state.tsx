import { CheckCircle2, Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Empty states explain why there is nothing and, where useful, what to do next. "success" is for good news
 * ("nothing needs attention"), "neutral" for absence of data.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = "neutral",
  compact,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "success";
  compact?: boolean;
  className?: string;
}) {
  const Icon = icon ?? (tone === "success" ? CheckCircle2 : Inbox);
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 text-center",
        compact ? "py-8" : "py-14",
        className,
      )}
    >
      <span
        className={cn(
          "mb-3 flex size-10 items-center justify-center rounded-full",
          tone === "success" ? "bg-success-soft text-success" : "bg-surface-muted text-muted",
        )}
      >
        <Icon aria-hidden className="size-5" />
      </span>
      <p className="text-foreground text-sm font-semibold">{title}</p>
      {description && <p className="text-muted mt-1 max-w-sm text-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
