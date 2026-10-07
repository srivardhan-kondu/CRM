"use client";

import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError, useResultAction, type ResultState } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface EntryRow {
  /** Student id (internal marks) or registration id (semester-end marks). */
  id: string;
  studentNumber: string;
  name: string;
  max: number;
  marks: number | null;
  absent: boolean;
  /** Why the row cannot take marks (e.g. not eligible to sit). */
  locked?: string;
  /** Extra read-only context shown beside the input (e.g. other components). */
  aside?: string;
}

type Entry = { marks: string; absent: boolean };

/**
 * A mark sheet: one number per row (half marks allowed) or "absent". Validates against each row's maximum in the
 * browser for fast feedback; the server and the database validate again.
 */
export function EntrySheet({
  rows,
  action,
  hidden,
  label,
  readonly,
}: {
  rows: EntryRow[];
  action: (prev: never, form: FormData) => Promise<ResultState>;
  hidden: Record<string, string>;
  label: string;
  readonly?: boolean;
}) {
  const [entries, setEntries] = useState<Record<string, Entry>>(() =>
    Object.fromEntries(
      rows.map((r) => [r.id, { marks: r.marks === null ? "" : String(r.marks), absent: r.absent }]),
    ),
  );
  const [state, formAction, pending] = useResultAction(action, () => {});
  const invalid = useMemo(
    () =>
      rows
        .filter((r) => {
          const e = entries[r.id]!;
          if (e.absent || e.marks.trim() === "") return false;
          const n = Number(e.marks);
          return !Number.isFinite(n) || n < 0 || n > r.max || Math.round(n * 2) !== n * 2;
        })
        .map((r) => r.id),
    [rows, entries],
  );
  const filled = rows.filter(
    (r) => !r.locked && (entries[r.id]!.absent || entries[r.id]!.marks.trim() !== ""),
  ).length;
  const open = rows.filter((r) => !r.locked).length;
  const payload = Object.fromEntries(
    rows
      .filter((r) => !r.locked)
      .map((r) => {
        const e = entries[r.id]!;
        return [
          r.id,
          { marks: e.absent || e.marks.trim() === "" ? null : Number(e.marks), absent: e.absent },
        ];
      }),
  );

  return (
    <form action={formAction} className="space-y-3">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="entries" value={JSON.stringify(payload)} />
      <p className="text-muted text-sm" aria-live="polite">
        {filled} of {open} entered
        {invalid.length > 0 && <span className="text-danger"> · {invalid.length} out of range</span>}
      </p>
      <div className="border-border overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border text-2xs text-subtle border-b text-left tracking-wide uppercase">
              <th className="px-3 py-2 font-medium">Student</th>
              <th className="px-3 py-2 font-medium">Marks</th>
              <th className="px-3 py-2 font-medium">Absent</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {rows.map((r) => {
              const e = entries[r.id]!;
              const bad = invalid.includes(r.id);
              return (
                <tr key={r.id} className={cn(r.locked && "opacity-60")}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-2xs text-subtle font-mono">
                      {r.studentNumber}
                      {r.aside && <span className="ml-2 font-sans">{r.aside}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {r.locked ? (
                      <span className="text-muted text-xs">{r.locked}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <Input
                          aria-label={`Marks for ${r.name}`}
                          inputMode="decimal"
                          value={e.absent ? "" : e.marks}
                          disabled={e.absent || readonly}
                          onChange={(ev) =>
                            setEntries((p) => ({ ...p, [r.id]: { ...p[r.id]!, marks: ev.target.value } }))
                          }
                          className={cn("h-8 w-20 text-right tabular-nums", bad && "border-danger")}
                          aria-invalid={bad}
                        />
                        <span className="text-subtle text-xs">/ {r.max}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {!r.locked && (
                      <input
                        type="checkbox"
                        aria-label={`${r.name} absent`}
                        checked={e.absent}
                        disabled={readonly}
                        onChange={(ev) =>
                          setEntries((p) => ({ ...p, [r.id]: { ...p[r.id]!, absent: ev.target.checked } }))
                        }
                        className="accent-brand size-4"
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <FormError state={state} />
      {!readonly && (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending || invalid.length > 0}>
            {pending && <Loader2 className="animate-spin" />} {label}
          </Button>
        </div>
      )}
    </form>
  );
}

/** A single-button form posting hidden fields to an action (submit, publish, request). */
export function ActionButton({
  action,
  hidden,
  label,
  variant = "primary",
  disabled,
}: {
  action: (prev: never, form: FormData) => Promise<ResultState>;
  hidden: Record<string, string>;
  label: string;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useResultAction(action, () => {});
  return (
    <form action={formAction} className="inline-flex flex-col items-end gap-1">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Button type="submit" size="sm" variant={variant} disabled={pending || disabled}>
        {pending && <Loader2 className="animate-spin" />} {label}
      </Button>
      <FormError state={state} />
    </form>
  );
}
