import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section className={cn("border-border bg-surface rounded-lg border shadow-xs", className)} {...props} />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<"header">) {
  return (
    <header
      className={cn("border-border flex items-start justify-between gap-3 border-b px-4 py-3", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("text-foreground text-sm font-semibold", className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-muted mt-0.5 text-xs", className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("p-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<"footer">) {
  return (
    <footer
      className={cn(
        "border-border text-muted flex items-center gap-2 border-t px-4 py-2.5 text-xs",
        className,
      )}
      {...props}
    />
  );
}
