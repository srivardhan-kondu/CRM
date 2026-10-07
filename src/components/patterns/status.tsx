import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  GraduationCap,
  LogOut,
  Clock,
  Info,
  PauseCircle,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Severity } from "@/domains/announcements/types";
import type { FeeStatus, RiskLevel, StudentStatus } from "@/domains/students/types";
import { DEFAULT_THRESHOLD_PCT } from "@/domains/attendance/rules";

/* Status is always text + icon + color — never color alone. */

export function RiskBadge({ level }: { level: RiskLevel }) {
  if (level === "high")
    return (
      <Badge tone="danger">
        <ShieldAlert aria-hidden /> High risk
      </Badge>
    );
  if (level === "watch")
    return (
      <Badge tone="warning">
        <AlertTriangle aria-hidden /> Watch
      </Badge>
    );
  return (
    <Badge tone="success">
      <CheckCircle2 aria-hidden /> On track
    </Badge>
  );
}

export function FeeBadge({ status }: { status: FeeStatus }) {
  if (status === "overdue")
    return (
      <Badge tone="danger">
        <XCircle aria-hidden /> Overdue
      </Badge>
    );
  if (status === "due")
    return (
      <Badge tone="warning">
        <Clock aria-hidden /> Due
      </Badge>
    );
  return (
    <Badge tone="success">
      <CheckCircle2 aria-hidden /> Paid
    </Badge>
  );
}

export function StudentStatusBadge({ status }: { status: StudentStatus }) {
  if (status === "on_leave")
    return (
      <Badge tone="info">
        <PauseCircle aria-hidden /> On leave
      </Badge>
    );
  if (status === "detained")
    return (
      <Badge tone="danger">
        <XCircle aria-hidden /> Detained
      </Badge>
    );
  if (status === "graduated")
    return (
      <Badge tone="brand">
        <GraduationCap aria-hidden /> Graduated
      </Badge>
    );
  if (status === "withdrawn")
    return (
      <Badge tone="neutral">
        <LogOut aria-hidden /> Withdrawn
      </Badge>
    );
  return (
    <Badge tone="success">
      <CircleDot aria-hidden /> Active
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  switch (severity) {
    case "critical":
      return (
        <Badge tone="danger">
          <AlertOctagon aria-hidden /> Critical
        </Badge>
      );
    case "high":
      return (
        <Badge tone="warning">
          <AlertTriangle aria-hidden /> High
        </Badge>
      );
    case "normal":
      return (
        <Badge tone="info">
          <Info aria-hidden /> Normal
        </Badge>
      );
    case "low":
      return <Badge tone="neutral">Low</Badge>;
  }
}

/** Below threshold is a warning, and danger once recovery is unlikely (under 65%). */
export function attendanceTone(
  pct: number,
  threshold = DEFAULT_THRESHOLD_PCT,
): "success" | "warning" | "danger" {
  if (pct < threshold) return pct < 65 ? "danger" : "warning";
  return "success";
}

export function AttendanceValue({ pct, threshold }: { pct: number; threshold?: number }) {
  const tone = attendanceTone(pct, threshold);
  const color = {
    success: "text-foreground",
    warning: "text-warning-soft-foreground",
    danger: "text-danger",
  }[tone];
  return (
    <span className={`tabular inline-flex items-center gap-1 font-medium ${color}`}>
      {tone !== "success" && <AlertTriangle aria-label="Below threshold" className="size-3.5" />}
      {pct.toFixed(1)}%
    </span>
  );
}
