"use server";

import { revalidatePath } from "next/cache";
import {
  completeRevaluation,
  decideCondonation,
  moderateComponent,
  publishResults,
  requestCondonation,
  requestRevaluation,
  saveMarks,
  saveSeeMarks,
  submitComponent,
} from "@/domains/exams/service";
import type { ActionResult } from "@/lib/audit/result";
import { currentAuth } from "@/lib/authz/context";

/*
 * Assessment and examination endpoints. Each re-authenticates and delegates to the domain service, which authorizes,
 * validates, writes the change with its audit event in one transaction, and explains the outcome.
 */

export type FormState = ActionResult | null;
type Authed = NonNullable<Awaited<ReturnType<typeof currentAuth>>>;

async function run(fn: (a: Authed) => Promise<ActionResult>): Promise<ActionResult> {
  const authed = await currentAuth();
  if (!authed) return { ok: false, error: "Your session has ended. Sign in again." };
  const result = await fn(authed);
  // Results feed CGPA everywhere (Student 360, dashboards, risk): refresh the whole shell.
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

const field = (form: FormData, name: string) => form.get(name) ?? undefined;

function entriesOf(form: FormData): unknown {
  try {
    return JSON.parse(String(form.get("entries") ?? "{}"));
  } catch {
    return {};
  }
}

export async function saveMarksAction(_prev: FormState, form: FormData) {
  return run((a) => saveMarks(a, { componentId: field(form, "componentId"), entries: entriesOf(form) }));
}

export async function submitComponentAction(_prev: FormState, form: FormData) {
  return run((a) => submitComponent(a, { componentId: field(form, "componentId") }));
}

export async function moderateAction(_prev: FormState, form: FormData) {
  return run((a) =>
    moderateComponent(a, {
      componentId: field(form, "componentId"),
      decision: field(form, "decision"),
      note: field(form, "note") || undefined,
    }),
  );
}

export async function saveSeeMarksAction(_prev: FormState, form: FormData) {
  return run((a) =>
    saveSeeMarks(a, {
      eventId: field(form, "eventId"),
      courseId: field(form, "courseId"),
      entries: entriesOf(form),
    }),
  );
}

export async function publishAction(_prev: FormState, form: FormData) {
  return run((a) => publishResults(a, { eventId: field(form, "eventId") }));
}

export async function requestCondonationAction(_prev: FormState, form: FormData) {
  return run((a) =>
    requestCondonation(a, { studentId: field(form, "studentId"), reason: field(form, "reason") }),
  );
}

export async function decideCondonationAction(_prev: FormState, form: FormData) {
  return run((a) =>
    decideCondonation(a, {
      id: field(form, "id"),
      decision: field(form, "decision"),
      note: field(form, "note") || undefined,
    }),
  );
}

export async function requestRevaluationAction(_prev: FormState, form: FormData) {
  return run((a) => requestRevaluation(a, { resultId: field(form, "resultId") }));
}

export async function completeRevaluationAction(_prev: FormState, form: FormData) {
  return run((a) =>
    completeRevaluation(a, { id: field(form, "id"), revaluedSee: field(form, "revaluedSee") }),
  );
}
