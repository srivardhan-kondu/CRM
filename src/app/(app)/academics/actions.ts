"use server";

import { revalidatePath } from "next/cache";
import {
  addRegulationCourse,
  allocateFaculty,
  changeRegulationStatus,
  createCourse,
  createDraftRegulation,
  generateOfferings,
  removeAllocation,
  removeRegulationCourse,
  setCurrentTerm,
} from "@/domains/academics/service";
import type { ActionResult } from "@/lib/audit/result";
import { currentAuth } from "@/lib/authz/context";

/*
 * Academic structure endpoints. Each re-authenticates and delegates to the domain service, which authorizes,
 * validates, writes the change with its audit event in one transaction, and explains the outcome.
 */

export type FormState = ActionResult | null;
type Authed = NonNullable<Awaited<ReturnType<typeof currentAuth>>>;

async function run(fn: (a: Authed) => Promise<ActionResult>): Promise<ActionResult> {
  const authed = await currentAuth();
  if (!authed) return { ok: false, error: "Your session has ended. Sign in again." };
  const result = await fn(authed);
  // Structure changes ripple across modules (offerings, teaching access, Student 360), so refresh the shell.
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

const field = (form: FormData, name: string) => form.get(name) ?? undefined;

export async function createCourseAction(_prev: FormState, form: FormData) {
  return run((a) =>
    createCourse(a, {
      code: field(form, "code"),
      name: field(form, "name"),
      ownerUnitId: field(form, "ownerUnitId"),
      type: field(form, "type"),
      credits: field(form, "credits"),
      lectureHours: field(form, "lectureHours"),
      tutorialHours: field(form, "tutorialHours"),
      practicalHours: field(form, "practicalHours"),
    }),
  );
}

export async function createDraftAction(_prev: FormState, form: FormData) {
  return run((a) =>
    createDraftRegulation(a, {
      fromCurriculumId: field(form, "fromCurriculumId"),
      code: field(form, "code"),
      effectiveFromYear: field(form, "effectiveFromYear"),
    }),
  );
}

export async function addRegulationCourseAction(_prev: FormState, form: FormData) {
  return run((a) =>
    addRegulationCourse(a, {
      curriculumId: field(form, "curriculumId"),
      courseId: field(form, "courseId"),
      semester: field(form, "semester"),
      category: field(form, "category"),
    }),
  );
}

export async function removeRegulationCourseAction(curriculumId: string, courseId: string) {
  return run((a) => removeRegulationCourse(a, { curriculumId, courseId }));
}

export async function changeRegulationStatusAction(curriculumId: string, to: "active" | "retired") {
  return run((a) => changeRegulationStatus(a, { curriculumId, to }));
}

export async function setCurrentTermAction(termId: string) {
  return run((a) => setCurrentTerm(a, { termId }));
}

export async function generateOfferingsAction(termId: string) {
  return run((a) => generateOfferings(a, { termId }));
}

export async function allocateFacultyAction(_prev: FormState, form: FormData) {
  return run((a) =>
    allocateFaculty(a, {
      offeringId: field(form, "offeringId"),
      userId: field(form, "userId"),
      role: field(form, "role"),
    }),
  );
}

export async function removeAllocationAction(_prev: FormState, form: FormData) {
  return run((a) =>
    removeAllocation(a, { allocationId: field(form, "allocationId"), reason: field(form, "reason") }),
  );
}
