"use client";

import { Loader2, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { markSessionAction, requestChangeAction } from "@/app/(app)/attendance/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError, useResultAction } from "@/components/ui/form";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Mark = "present" | "absent";

export interface MarkRow {
  studentId: string;
  studentNumber: string;
  name: string;
  mark: Mark | null;
  leave: { kind: "od" | "medical"; status: "approved" | "pending" } | null;
}

function LeaveChip({ leave }: { leave: MarkRow["leave"] }) {
  if (!leave) return null;
  if (leave.status === "pending")
    return <Badge tone="neutral">{leave.kind === "od" ? "OD" : "Medical"} leave pending</Badge>;
  return leave.kind === "od" ? (
    <Badge tone="info">On duty · counts present</Badge>
  ) : (
    <Badge tone="info">Medical leave · excused</Badge>
  );
}

/**
 * Marks one class. `direct` saves immediately (same day); `request` sends the same marks for approval (later days);
 * `readonly` shows what was recorded.
 */
export function MarkForm({
  mode,
  offeringId,
  date,
  startsAt,
  rows,
  recordedStatus,
  recordedCancelReason,
}: {
  mode: "direct" | "request" | "readonly";
  offeringId: string;
  date: string;
  startsAt: string;
  rows: MarkRow[];
  recordedStatus: "held" | "cancelled" | null;
  recordedCancelReason: string | null;
}) {
  const [marks, setMarks] = useState<Record<string, Mark>>(() =>
    Object.fromEntries(rows.map((r) => [r.studentId, r.mark ?? "present"])),
  );
  const [notHeld, setNotHeld] = useState(recordedStatus === "cancelled");
  const [cancelReason, setCancelReason] = useState(recordedCancelReason ?? "");
  const [query, setQuery] = useState("");
  const [state, action, pending] = useResultAction(
    mode === "request" ? requestChangeAction : markSessionAction,
    () => {},
  );
  const readonly = mode === "readonly";

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.studentNumber.toLowerCase().includes(q))
      : rows;
  }, [rows, query]);
  const present = Object.values(marks).filter((m) => m === "present").length;
  const absent = rows.length - present;
  const setAll = (m: Mark) => setMarks(Object.fromEntries(rows.map((r) => [r.studentId, m])));

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="offeringId" value={offeringId} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="startsAt" value={startsAt} />
      <input type="hidden" name="status" value={notHeld ? "cancelled" : "held"} />
      <input type="hidden" name="marks" value={notHeld ? "{}" : JSON.stringify(marks)} />

      {!readonly && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={notHeld}
            onChange={(e) => setNotHeld(e.target.checked)}
            className="accent-brand mt-0.5 size-4"
          />
          <span>
            The class was not held
            <span className="text-muted block text-xs">
              Not held classes don&apos;t count towards anyone&apos;s attendance.
            </span>
          </span>
        </label>
      )}

      {notHeld ? (
        <div className="space-y-1.5">
          <Label htmlFor="cancelReason">Why was it not held?</Label>
          <Input
            id="cancelReason"
            name="cancelReason"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            readOnly={readonly}
            required
            minLength={3}
            placeholder="e.g. Faculty on approved leave"
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <p className="tabular mr-auto text-sm" aria-live="polite">
              <span className="text-success-soft-foreground font-semibold">{present} present</span>
              <span className="text-subtle"> · </span>
              <span className={cn("font-semibold", absent > 0 ? "text-danger" : "text-muted")}>
                {absent} absent
              </span>
              <span className="text-subtle"> · {rows.length} on roll</span>
            </p>
            <div className="relative">
              <Search
                aria-hidden
                className="text-subtle pointer-events-none absolute top-2.5 left-2.5 size-4"
              />
              <Input
                aria-label="Find a student"
                placeholder="Find a student"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-48 pl-8"
              />
            </div>
            {!readonly && (
              <>
                <Button type="button" variant="secondary" size="sm" onClick={() => setAll("present")}>
                  All present
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setAll("absent")}>
                  All absent
                </Button>
              </>
            )}
          </div>

          <ul className="border-border divide-border divide-y rounded-md border">
            {shown.map((r) => {
              const m = marks[r.studentId]!;
              return (
                <li
                  key={r.studentId}
                  className={cn(
                    "flex flex-wrap items-center gap-3 px-3 py-2",
                    m === "absent" && "bg-danger-soft/40",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.name}</p>
                    <p className="text-2xs text-subtle flex flex-wrap items-center gap-2 font-mono">
                      {r.studentNumber}
                      <LeaveChip leave={r.leave} />
                    </p>
                  </div>
                  <div
                    role="radiogroup"
                    aria-label={r.name}
                    className="border-border flex overflow-hidden rounded-md border"
                  >
                    {(["present", "absent"] as const).map((value) => (
                      <label
                        key={value}
                        className={cn(
                          "flex min-h-10 min-w-20 cursor-pointer items-center justify-center px-3 text-sm font-medium select-none",
                          "has-[:focus-visible]:ring-brand has-[:focus-visible]:ring-2",
                          m === value
                            ? value === "present"
                              ? "bg-success text-white"
                              : "bg-danger text-white"
                            : "bg-surface text-muted hover:bg-surface-muted",
                          readonly && "cursor-default",
                        )}
                      >
                        <input
                          type="radio"
                          className="sr-only"
                          name={`mark-${r.studentId}`}
                          value={value}
                          checked={m === value}
                          disabled={readonly}
                          onChange={() => setMarks((prev) => ({ ...prev, [r.studentId]: value }))}
                        />
                        {value === "present" ? "Present" : "Absent"}
                      </label>
                    ))}
                  </div>
                </li>
              );
            })}
            {shown.length === 0 && (
              <li className="text-muted px-3 py-6 text-center text-sm">No student matches.</li>
            )}
          </ul>
        </>
      )}

      {mode === "request" && (
        <div className="space-y-1.5">
          <Label htmlFor="reason">Reason for the change</Label>
          <textarea
            id="reason"
            name="reason"
            required
            minLength={10}
            rows={2}
            className="border-border bg-surface focus-visible:ring-brand w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
            placeholder="e.g. Two students were at the department seminar and were marked absent by mistake."
          />
          <p className="text-2xs text-subtle">Your HOD approves it; the change applies once approved.</p>
        </div>
      )}

      <FormError state={state} />
      {!readonly && (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            {mode === "request"
              ? "Send for approval"
              : recordedStatus
                ? "Update attendance"
                : "Save attendance"}
          </Button>
        </div>
      )}
    </form>
  );
}
