"use server";

import { revalidatePath } from "next/cache";
import { transferStudent, updateStudentProfile } from "@/domains/students/service";
import type { ActionResult } from "@/lib/audit/result";
import { currentAuth } from "@/lib/authz/context";

/* Public endpoints: each re-authenticates and delegates to the domain service, which authorizes and audits. */

export type FormState = ActionResult | null;

async function run(
  studentId: string,
  fn: (a: NonNullable<Awaited<ReturnType<typeof currentAuth>>>) => Promise<ActionResult>,
) {
  const authed = await currentAuth();
  if (!authed) return { ok: false as const, error: "Your session has ended. Sign in again." };
  const result = await fn(authed);
  if (result.ok) revalidatePath(`/students/${studentId}`);
  return result;
}

export async function updateStudentAction(_prev: FormState, form: FormData): Promise<ActionResult> {
  const studentId = String(form.get("studentId") ?? "");
  return run(studentId, (a) =>
    updateStudentProfile(a, {
      studentId,
      email: form.get("email"),
      phone: form.get("phone"),
      status: form.get("status"),
      hosteller: form.get("hosteller") ?? "false",
    }),
  );
}

export async function transferStudentAction(_prev: FormState, form: FormData): Promise<ActionResult> {
  const studentId = String(form.get("studentId") ?? "");
  return run(studentId, (a) =>
    transferStudent(a, { studentId, toSectionId: form.get("toSectionId"), reason: form.get("reason") }),
  );
}
