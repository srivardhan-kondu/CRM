"use server";

import { revalidatePath } from "next/cache";
import {
  applyLeave,
  declareHoliday,
  decideLeave,
  decideRequest,
  markSession,
  requestChange,
  setInstitutionThreshold,
  setProgrammeThreshold,
  withdrawLeave,
  withdrawRequest,
} from "@/domains/attendance/service";
import type { ActionResult } from "@/lib/audit/result";
import { currentAuth } from "@/lib/authz/context";

/*
 * Attendance endpoints. Each re-authenticates and delegates to the domain service, which authorizes, validates,
 * writes the change with its audit event in one transaction, and explains the outcome.
 */

export type FormState = ActionResult | null;
type Authed = NonNullable<Awaited<ReturnType<typeof currentAuth>>>;

async function run(fn: (a: Authed) => Promise<ActionResult>): Promise<ActionResult> {
  const authed = await currentAuth();
  if (!authed) return { ok: false, error: "Your session has ended. Sign in again." };
  const result = await fn(authed);
  // Attendance feeds dashboards, Student 360, the task and approval badges: refresh the whole shell.
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

const field = (form: FormData, name: string) => form.get(name) ?? undefined;

function marksOf(form: FormData): unknown {
  try {
    return JSON.parse(String(form.get("marks") ?? "{}"));
  } catch {
    return {};
  }
}

function proposal(form: FormData) {
  return {
    offeringId: field(form, "offeringId"),
    date: field(form, "date"),
    startsAt: field(form, "startsAt"),
    status: field(form, "status"),
    cancelReason: field(form, "cancelReason") || undefined,
    marks: marksOf(form),
  };
}

export async function markSessionAction(_prev: FormState, form: FormData) {
  return run((a) => markSession(a, proposal(form)));
}

export async function requestChangeAction(_prev: FormState, form: FormData) {
  return run((a) => requestChange(a, { ...proposal(form), reason: field(form, "reason") }));
}

const decision = (form: FormData) => ({
  id: field(form, "id"),
  decision: field(form, "decision"),
  note: field(form, "note") || undefined,
});

export async function decideAction(_prev: FormState, form: FormData) {
  const input = decision(form);
  return run((a) => (field(form, "type") === "leave" ? decideLeave(a, input) : decideRequest(a, input)));
}

export async function withdrawAction(_prev: FormState, form: FormData) {
  const input = { id: field(form, "id") };
  return run((a) => (field(form, "type") === "leave" ? withdrawLeave(a, input) : withdrawRequest(a, input)));
}

export async function applyLeaveAction(_prev: FormState, form: FormData) {
  return run((a) =>
    applyLeave(a, {
      studentId: field(form, "studentId"),
      kind: field(form, "kind"),
      fromDate: field(form, "fromDate"),
      toDate: field(form, "toDate"),
      reason: field(form, "reason"),
    }),
  );
}

export async function setInstitutionThresholdAction(_prev: FormState, form: FormData) {
  return run((a) => setInstitutionThreshold(a, { thresholdPct: field(form, "thresholdPct") }));
}

export async function setProgrammeThresholdAction(_prev: FormState, form: FormData) {
  return run((a) =>
    setProgrammeThreshold(a, {
      programmeId: field(form, "programmeId"),
      thresholdPct: field(form, "thresholdPct"),
    }),
  );
}

export async function declareHolidayAction(_prev: FormState, form: FormData) {
  return run((a) => declareHoliday(a, { date: field(form, "date"), name: field(form, "name") }));
}
