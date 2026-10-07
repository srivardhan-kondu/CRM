import "server-only";

import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { denied, fail, successAudit, type ActionResult } from "@/lib/audit/result";
import type { Authed } from "@/lib/authz/context";
import { canAllocate, canManageAt, canManageTerms } from "./guards";
import { loadOfferingPlanInputs, loadRolePermissions, loadTerms } from "./load";
import { emptySemesters, planOfferings } from "./plan";

/*
 * Academic structure mutations. Each one authorizes with the academics guards, validates, then writes the change
 * and its audit event in one transaction under RLS. Refusals are audited as denials.
 */

const db = () => getDb();

/* ---------- Courses ---------- */

export const courseSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2,4}\d{3}[A-Z]?$/, "Course codes look like CS301 or CS301L."),
    name: z.string().trim().min(3, "Enter the course title.").max(120),
    ownerUnitId: z.uuid("Choose the owning department."),
    type: z.enum(["theory", "lab", "project"]),
    credits: z.coerce.number().int().min(0).max(30),
    lectureHours: z.coerce.number().int().min(0).max(12),
    tutorialHours: z.coerce.number().int().min(0).max(12),
    practicalHours: z.coerce.number().int().min(0).max(24),
  })
  .refine((c) => c.lectureHours + c.tutorialHours + c.practicalHours > 0, {
    message: "A course needs at least one contact hour per week.",
  });

export async function createCourse(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = courseSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid course.");
  const c = parsed.data;
  const owner = authed.tree.byId.get(c.ownerUnitId);
  if (!owner || (owner.type !== "department" && owner.type !== "school")) return fail("Unknown owning unit.");
  if (!canManageAt(authed.ctx, authed.tree, owner.id))
    return denied(authed, "course.create", "course", `You can't add courses owned by ${owner.name}.`, c.code);

  const [existing] = await withTenant(db(), authed.ctx.tenantId, (q) => [
    q.select({ id: s.course.id }).from(s.course).where(eq(s.course.code, c.code)),
  ]);
  if (existing.length) return fail(`${c.code} already exists in the catalogue.`);

  const id = crypto.randomUUID();
  const audit = await successAudit(authed, "course.create", "course", c.code, { ...c, owner: owner.code });
  await withTenant(db(), authed.ctx.tenantId, (q) => [
    q.insert(s.course).values({ id, tenantId: authed.ctx.tenantId, ...c }),
    q.insert(s.auditEvent).values(audit),
  ]);
  return { ok: true, message: `${c.code} ${c.name} added to the catalogue.`, auditId: audit.id };
}

/* ---------- Regulations ---------- */

async function regulationContext(authed: Authed, curriculumId: string) {
  const [rows] = await withTenant(db(), authed.ctx.tenantId, (q) => [
    q
      .select({
        id: s.curriculum.id,
        code: s.curriculum.code,
        status: s.curriculum.status,
        programmeId: s.programme.id,
        programmeCode: s.programme.code,
        programmeName: s.programme.name,
        semesters: s.programme.semesters,
        departmentId: s.programme.departmentId,
      })
      .from(s.curriculum)
      .innerJoin(s.programme, eq(s.programme.id, s.curriculum.programmeId))
      .where(eq(s.curriculum.id, curriculumId)),
  ]);
  return rows[0] ?? null;
}

export const draftSchema = z.object({
  fromCurriculumId: z.uuid(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^R\d{2}[A-Z]?$/, "Regulation codes look like R26."),
  effectiveFromYear: z.coerce.number().int().min(2000).max(2100),
});

/** New draft regulation, copied from an existing one — the usual way a revision starts. */
export async function createDraftRegulation(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid regulation.");
  const req = parsed.data;
  const from = await regulationContext(authed, req.fromCurriculumId);
  if (!from) return fail("Unknown regulation.");
  if (!canManageAt(authed.ctx, authed.tree, from.departmentId))
    return denied(
      authed,
      "regulation.create",
      "regulation",
      `You can't revise ${from.programmeName}.`,
      from.code,
    );

  const [dupe] = await withTenant(db(), authed.ctx.tenantId, (q) => [
    q
      .select({ id: s.curriculum.id })
      .from(s.curriculum)
      .where(and(eq(s.curriculum.programmeId, from.programmeId), eq(s.curriculum.code, req.code))),
  ]);
  if (dupe.length) return fail(`${from.programmeName} already has a regulation ${req.code}.`);

  const id = crypto.randomUUID();
  const name = `${from.programmeName} Regulation ${req.effectiveFromYear}`;
  const audit = await successAudit(
    authed,
    "regulation.create",
    "regulation",
    `${from.programmeCode}/${req.code}`,
    {
      derivedFrom: from.code,
      effectiveFromYear: req.effectiveFromYear,
    },
  );
  await withTenant(db(), authed.ctx.tenantId, (q) => [
    q.insert(s.curriculum).values({
      id,
      tenantId: authed.ctx.tenantId,
      programmeId: from.programmeId,
      code: req.code,
      name,
      status: "draft",
      effectiveFromYear: req.effectiveFromYear,
      derivedFromId: from.id,
      createdBy: authed.ctx.userId,
    }),
    q.insert(s.curriculumCourse).select(
      q
        .select({
          tenantId: s.curriculumCourse.tenantId,
          curriculumId: sql<string>`${id}::uuid`.as("curriculum_id"),
          courseId: s.curriculumCourse.courseId,
          semester: s.curriculumCourse.semester,
          category: s.curriculumCourse.category,
        })
        .from(s.curriculumCourse)
        .where(eq(s.curriculumCourse.curriculumId, from.id)),
    ),
    q.insert(s.auditEvent).values(audit),
  ]);
  return {
    ok: true,
    message: `Draft ${req.code} created from ${from.code}. Edit its courses, then publish.`,
    auditId: audit.id,
  };
}

export const regulationCourseSchema = z.object({
  curriculumId: z.uuid(),
  courseId: z.uuid("Choose a course."),
  semester: z.coerce.number().int().min(1).max(12),
  category: z.enum(["core", "elective", "lab", "project", "foundation"]),
});

async function draftForEdit(authed: Authed, curriculumId: string, action: string) {
  const reg = await regulationContext(authed, curriculumId);
  if (!reg) return { error: fail("Unknown regulation.") };
  if (!canManageAt(authed.ctx, authed.tree, reg.departmentId))
    return {
      error: await denied(authed, action, "regulation", `You can't edit ${reg.programmeName}.`, reg.code),
    };
  if (reg.status !== "draft")
    return {
      error: fail(`${reg.code} is ${reg.status}. Published regulations are frozen — start a new draft.`),
    };
  return { reg };
}

export async function addRegulationCourse(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = regulationCourseSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input.");
  const req = parsed.data;
  const { reg, error } = await draftForEdit(authed, req.curriculumId, "regulation.course_add");
  if (error) return error;
  if (req.semester > reg.semesters) return fail(`${reg.programmeName} has ${reg.semesters} semesters.`);

  const [course, present] = await withTenant(db(), authed.ctx.tenantId, (q) => [
    q
      .select({ code: s.course.code, name: s.course.name })
      .from(s.course)
      .where(eq(s.course.id, req.courseId)),
    q
      .select({ semester: s.curriculumCourse.semester })
      .from(s.curriculumCourse)
      .where(and(eq(s.curriculumCourse.curriculumId, reg.id), eq(s.curriculumCourse.courseId, req.courseId))),
  ]);
  if (!course[0]) return fail("Unknown course.");
  if (present[0])
    return fail(`${course[0].code} is already in semester ${present[0].semester} of ${reg.code}.`);

  const audit = await successAudit(
    authed,
    "regulation.course_add",
    "regulation",
    `${reg.programmeCode}/${reg.code}`,
    {
      course: course[0].code,
      semester: req.semester,
      category: req.category,
    },
  );
  await withTenant(db(), authed.ctx.tenantId, (q) => [
    q.insert(s.curriculumCourse).values({ tenantId: authed.ctx.tenantId, ...req }),
    q.insert(s.auditEvent).values(audit),
  ]);
  return {
    ok: true,
    message: `${course[0].code} added to semester ${req.semester} of ${reg.code}.`,
    auditId: audit.id,
  };
}

export async function removeRegulationCourse(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = z.object({ curriculumId: z.uuid(), courseId: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  const req = parsed.data;
  const { reg, error } = await draftForEdit(authed, req.curriculumId, "regulation.course_remove");
  if (error) return error;
  const [course] = await withTenant(db(), authed.ctx.tenantId, (q) => [
    q.select({ code: s.course.code }).from(s.course).where(eq(s.course.id, req.courseId)),
  ]);
  const audit = await successAudit(
    authed,
    "regulation.course_remove",
    "regulation",
    `${reg.programmeCode}/${reg.code}`,
    {
      course: course[0]?.code ?? req.courseId,
    },
  );
  await withTenant(db(), authed.ctx.tenantId, (q) => [
    q
      .delete(s.curriculumCourse)
      .where(and(eq(s.curriculumCourse.curriculumId, reg.id), eq(s.curriculumCourse.courseId, req.courseId))),
    q.insert(s.auditEvent).values(audit),
  ]);
  return { ok: true, message: `${course[0]?.code ?? "Course"} removed from ${reg.code}.`, auditId: audit.id };
}

/** draft → active (frozen), or active → retired (no new batches; existing batches keep it). */
export async function changeRegulationStatus(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = z.object({ curriculumId: z.uuid(), to: z.enum(["active", "retired"]) }).safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  const { curriculumId, to } = parsed.data;
  const action = to === "active" ? "regulation.publish" : "regulation.retire";
  const reg = await regulationContext(authed, curriculumId);
  if (!reg) return fail("Unknown regulation.");
  if (!canManageAt(authed.ctx, authed.tree, reg.departmentId))
    return denied(
      authed,
      action,
      "regulation",
      `You can't change ${reg.programmeName}'s regulations.`,
      reg.code,
    );
  const from = to === "active" ? "draft" : "active";
  if (reg.status !== from)
    return fail(
      `${reg.code} is ${reg.status}; only ${from} regulations can be ${to === "active" ? "published" : "retired"}.`,
    );

  if (to === "active") {
    const [rows] = await withTenant(db(), authed.ctx.tenantId, (q) => [
      q
        .select({ semester: s.curriculumCourse.semester })
        .from(s.curriculumCourse)
        .where(eq(s.curriculumCourse.curriculumId, reg.id)),
    ]);
    const gaps = emptySemesters(
      reg.semesters,
      rows.map((r) => r.semester),
    );
    if (gaps.length)
      return fail(
        `Semester${gaps.length > 1 ? "s" : ""} ${gaps.join(", ")} ha${gaps.length > 1 ? "ve" : "s"} no courses yet.`,
      );
  }

  const audit = await successAudit(authed, action, "regulation", `${reg.programmeCode}/${reg.code}`, {
    from: reg.status,
    to,
  });
  await withTenant(db(), authed.ctx.tenantId, (q) => [
    q
      .update(s.curriculum)
      .set(
        to === "active"
          ? { status: to, publishedAt: new Date(), publishedBy: authed.ctx.userId }
          : { status: to },
      )
      .where(and(eq(s.curriculum.id, reg.id), eq(s.curriculum.status, from))),
    q.insert(s.auditEvent).values(audit),
  ]);
  return {
    ok: true,
    message:
      to === "active" ? `${reg.code} published. Its course list is now frozen.` : `${reg.code} retired.`,
    auditId: audit.id,
  };
}

/* ---------- Terms and offerings ---------- */

export async function setCurrentTerm(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = z.object({ termId: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  if (!canManageTerms(authed.ctx, authed.tree))
    return denied(
      authed,
      "term.set_current",
      "term",
      "Only institution-level academic administrators can change the current term.",
    );
  const terms = await loadTerms(db(), authed.ctx.tenantId);
  const term = terms.find((t) => t.id === parsed.data.termId);
  if (!term) return fail("Unknown term.");
  if (term.isCurrent) return fail(`${term.name} is already the current term.`);
  const previous = terms.find((t) => t.isCurrent);
  const audit = await successAudit(authed, "term.set_current", "term", term.code, {
    previous: previous?.code ?? null,
  });
  await withTenant(db(), authed.ctx.tenantId, (q) => [
    q.update(s.academicTerm).set({ isCurrent: false }).where(ne(s.academicTerm.id, term.id)),
    q.update(s.academicTerm).set({ isCurrent: true }).where(eq(s.academicTerm.id, term.id)),
    q.insert(s.auditEvent).values(audit),
  ]);
  return {
    ok: true,
    message: `${term.name} is now the current term. Teaching access follows its allocations from the next request.`,
    auditId: audit.id,
  };
}

/** Creates a term's missing offerings from each section's regulation, for the sections the user manages. */
export async function generateOfferings(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = z.object({ termId: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  const terms = await loadTerms(db(), authed.ctx.tenantId);
  const term = terms.find((t) => t.id === parsed.data.termId);
  if (!term) return fail("Unknown term.");
  const inputs = await loadOfferingPlanInputs(db(), authed.ctx.tenantId, term.id);
  const manageable = (sectionId: string) => canManageAt(authed.ctx, authed.tree, sectionId);
  if (!inputs.sections.some((sec) => manageable(sec.sectionId)))
    return denied(authed, "offering.generate", "term", "You don't manage any sections.", term.code);

  const planned = planOfferings(
    { term, sections: inputs.sections, courses: inputs.courses, existing: inputs.existing },
    manageable,
  );
  if (planned.length === 0) return fail(`Every section you manage already has its ${term.name} offerings.`);
  const audit = await successAudit(authed, "offering.generate", "term", term.code, {
    offerings: planned.length,
    sections: new Set(planned.map((p) => p.sectionId)).size,
  });
  const status = term.isCurrent ? ("active" as const) : ("planned" as const);
  await withTenant(db(), authed.ctx.tenantId, (q) => [
    q
      .insert(s.courseOffering)
      .values(
        planned.map((p) => ({
          tenantId: authed.ctx.tenantId,
          termId: term.id,
          courseId: p.courseId,
          sectionId: p.sectionId,
          status,
        })),
      )
      .onConflictDoNothing(),
    q.insert(s.auditEvent).values(audit),
  ]);
  return {
    ok: true,
    message: `${planned.length} offerings created for ${term.name} across ${new Set(planned.map((p) => p.sectionId)).size} sections.`,
    auditId: audit.id,
  };
}

/* ---------- Teaching allocation ---------- */

export const allocateSchema = z.object({
  offeringId: z.uuid(),
  userId: z.uuid("Choose a faculty member."),
  role: z.enum(["primary", "co_teacher", "lab"]).default("primary"),
});

async function offeringContext(authed: Authed, offeringId: string) {
  const [rows] = await withTenant(db(), authed.ctx.tenantId, (q) => [
    q
      .select({
        id: s.courseOffering.id,
        sectionId: s.courseOffering.sectionId,
        sectionLabel: s.section.label,
        courseCode: s.course.code,
        termCode: s.academicTerm.code,
      })
      .from(s.courseOffering)
      .innerJoin(s.section, eq(s.section.orgUnitId, s.courseOffering.sectionId))
      .innerJoin(s.course, eq(s.course.id, s.courseOffering.courseId))
      .innerJoin(s.academicTerm, eq(s.academicTerm.id, s.courseOffering.termId))
      .where(eq(s.courseOffering.id, offeringId)),
  ]);
  return rows[0] ?? null;
}

export async function allocateFaculty(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = allocateSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input.");
  const req = parsed.data;
  const offering = await offeringContext(authed, req.offeringId);
  if (!offering) return fail("Unknown offering.");
  const guard = canAllocate(authed.ctx, authed.tree, {
    sectionId: offering.sectionId,
    targetUserId: req.userId,
    facultyPermissions: await loadRolePermissions(db(), authed.ctx.tenantId, "faculty"),
  });
  if (!guard.ok)
    return denied(
      authed,
      "teaching.allocate",
      "offering",
      guard.reason,
      `${offering.termCode}/${offering.sectionLabel}/${offering.courseCode}`,
    );

  const [faculty, current] = await withTenant(db(), authed.ctx.tenantId, (q) => [
    q
      .select({ name: s.appUser.name, status: s.facultyProfile.status })
      .from(s.facultyProfile)
      .innerJoin(s.appUser, eq(s.appUser.id, s.facultyProfile.userId))
      .where(eq(s.facultyProfile.userId, req.userId)),
    q
      .select({ userId: s.teachingAllocation.userId })
      .from(s.teachingAllocation)
      .where(and(eq(s.teachingAllocation.offeringId, offering.id), isNull(s.teachingAllocation.removedAt))),
  ]);
  const member = faculty[0];
  if (!member) return fail("That person has no faculty profile in this institution.");
  if (member.status !== "active")
    return fail(`${member.name} is ${member.status.replace("_", " ")} and can't be allocated.`);
  if (current.some((c) => c.userId === req.userId))
    return fail(`${member.name} already teaches this offering.`);

  const audit = await successAudit(authed, "teaching.allocate", "offering", offering.id, {
    term: offering.termCode,
    section: offering.sectionLabel,
    course: offering.courseCode,
    facultyUserId: req.userId,
    role: req.role,
  });
  await withTenant(db(), authed.ctx.tenantId, (q) => [
    q.insert(s.teachingAllocation).values({
      tenantId: authed.ctx.tenantId,
      offeringId: offering.id,
      userId: req.userId,
      role: req.role,
      allocatedBy: authed.ctx.userId,
    }),
    q.insert(s.auditEvent).values(audit),
  ]);
  return {
    ok: true,
    message: `${member.name} now teaches ${offering.courseCode} to ${offering.sectionLabel}. Their access applies from their next request.`,
    auditId: audit.id,
  };
}

export async function removeAllocation(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({
      allocationId: z.uuid(),
      reason: z.string().trim().min(3, "Give a reason for the change.").max(300),
    })
    .safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input.");
  const req = parsed.data;
  const [rows] = await withTenant(db(), authed.ctx.tenantId, (q) => [
    q
      .select({
        offeringId: s.teachingAllocation.offeringId,
        userId: s.teachingAllocation.userId,
        name: s.appUser.name,
      })
      .from(s.teachingAllocation)
      .innerJoin(s.appUser, eq(s.appUser.id, s.teachingAllocation.userId))
      .where(and(eq(s.teachingAllocation.id, req.allocationId), isNull(s.teachingAllocation.removedAt))),
  ]);
  const allocation = rows[0];
  if (!allocation) return fail("That allocation no longer exists.");
  const offering = (await offeringContext(authed, allocation.offeringId))!;
  const guard = canAllocate(authed.ctx, authed.tree, {
    sectionId: offering.sectionId,
    targetUserId: allocation.userId,
    facultyPermissions: await loadRolePermissions(db(), authed.ctx.tenantId, "faculty"),
  });
  if (!guard.ok) return denied(authed, "teaching.remove", "offering", guard.reason, offering.id);

  const audit = await successAudit(authed, "teaching.remove", "offering", offering.id, {
    term: offering.termCode,
    section: offering.sectionLabel,
    course: offering.courseCode,
    facultyUserId: allocation.userId,
    reason: req.reason,
  });
  await withTenant(db(), authed.ctx.tenantId, (q) => [
    q
      .update(s.teachingAllocation)
      .set({ removedAt: new Date(), removedBy: authed.ctx.userId, removeReason: req.reason })
      .where(and(eq(s.teachingAllocation.id, req.allocationId), isNull(s.teachingAllocation.removedAt))),
    q.insert(s.auditEvent).values(audit),
  ]);
  return {
    ok: true,
    message: `${allocation.name} no longer teaches ${offering.courseCode} to ${offering.sectionLabel}.`,
    auditId: audit.id,
  };
}
