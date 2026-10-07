import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const field =
  "h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground shadow-xs transition-colors placeholder:text-subtle hover:border-border-strong focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-60";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(field, className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        field,
        "appearance-none bg-[length:16px] bg-[right_0.5rem_center] bg-no-repeat pr-8",
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...props}
    >
      {children}
    </select>
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-foreground text-xs font-medium", className)} {...props} />;
}
