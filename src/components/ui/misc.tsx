import type { ComponentProps } from "react";
import { cn, initials } from "@/lib/utils";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div aria-hidden className={cn("bg-surface-sunken animate-pulse rounded-md", className)} {...props} />
  );
}

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "border-border bg-surface-muted text-2xs text-muted inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 font-sans font-medium",
        className,
      )}
      {...props}
    />
  );
}

export function Separator({ className, vertical, ...props }: ComponentProps<"div"> & { vertical?: boolean }) {
  return (
    <div
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      className={cn("bg-border shrink-0", vertical ? "h-full w-px" : "h-px w-full", className)}
      {...props}
    />
  );
}

const AVATAR_TONES = [
  "bg-brand-soft text-brand-soft-foreground",
  "bg-success-soft text-success-soft-foreground",
  "bg-warning-soft text-warning-soft-foreground",
  "bg-info-soft text-info-soft-foreground",
  "bg-danger-soft text-danger-soft-foreground",
];

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const tone = AVATAR_TONES[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  const sizes = { sm: "size-7 text-2xs", md: "size-8 text-xs", lg: "size-10 text-sm", xl: "size-14 text-lg" };
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        sizes[size],
        tone,
        className,
      )}
    >
      {initials(name.replace(/^(Dr\.|Prof\.|Mr\.|Ms\.|Mrs\.)\s+/, ""))}
    </span>
  );
}

/** Thin horizontal meter. Value 0–100. Tone conveys status; the numeric label must accompany it. */
export function Meter({
  value,
  tone = "brand",
  className,
  label,
}: {
  value: number;
  tone?: "brand" | "success" | "warning" | "danger";
  className?: string;
  label: string;
}) {
  const fill = { brand: "bg-brand", success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[tone];
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      className={cn("bg-surface-sunken h-1.5 w-full overflow-hidden rounded-full", className)}
    >
      <div
        className={cn("h-full rounded-full", fill)}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
