import { Construction, Lock, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Explains why there is no data and offers the next useful action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className="bg-surface-muted text-muted mb-3 flex size-10 items-center justify-center rounded-full">
        <Icon aria-hidden className="size-5" />
      </div>
      <h3 className="text-foreground text-sm font-semibold">{title}</h3>
      <p className="text-muted mt-1 max-w-sm text-sm">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Shown when a module or field is outside the user's permissions. Does not reveal counts or existence. */
export function PermissionState({
  title = "Not available for your role",
  description,
}: {
  title?: string;
  description: ReactNode;
}) {
  return <EmptyState icon={Lock} title={title} description={description} />;
}

export function PhaseNote({
  phase,
  children,
  className,
}: {
  phase: number;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("text-2xs text-subtle inline-flex items-center gap-1 font-medium", className)}>
      <Construction aria-hidden className="size-3" />
      {children ?? `Arrives in Phase ${phase}`}
    </span>
  );
}
