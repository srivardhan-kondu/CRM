import { isWithin, overlaps, parseSectionCode } from "@/lib/authz/org-tree";
import type { OrgNode, OrgTree } from "@/lib/authz/types";
import type { Student } from "@/domains/students/types";
import type {
  Announcement,
  AnnouncementCategory,
  AudienceGroup,
  AudienceRule,
  InboxItem,
  InboxView,
} from "./types";

export type Recipient = "students" | "guardians" | "staff";

/** Does the rule's audience include this group of people? */
export function includes(rule: AudienceRule, who: Recipient): boolean {
  if (rule.kind === "placement_eligible") return who === "students";
  const groups: Record<AudienceGroup, readonly Recipient[]> = {
    everyone: ["students", "guardians", "staff"],
    families: ["students", "guardians"],
    students: ["students"],
    guardians: ["guardians"],
    staff: ["staff"],
  };
  return groups[rule.audience].includes(who);
}

export type StudentPlacement = Pick<Student, "departmentCode" | "year" | "sectionId">;

/**
 * Who is reading. Staff read through their assignment units: a notice is addressed to them when it includes staff and
 * its target overlaps their scope, and visible (oversight) whenever the target overlaps their scope. Students and
 * guardians read through linked student records: only notices whose target holds that student and whose audience
 * includes them. A user can be several of these at once. Deny by default.
 */
export interface Viewer {
  tree: OrgTree;
  staffUnits: readonly OrgNode[];
  students: readonly (StudentPlacement & { id: string; relation: "self" | "guardian" })[];
}

/** Does the rule's target hold this student (regardless of audience group)? */
export function targetsStudent(rule: AudienceRule, s: StudentPlacement): boolean {
  switch (rule.kind) {
    case "institution":
      return true;
    case "department":
      return rule.departmentCode === s.departmentCode;
    case "year":
      return rule.departmentCode === s.departmentCode && rule.year === s.year;
    case "section":
      return rule.sectionId === s.sectionId;
    case "placement_eligible":
      return (rule.departmentCodes as readonly string[]).includes(s.departmentCode) && rule.year === s.year;
  }
}

function matchesLinked(rule: AudienceRule, s: Viewer["students"][number]): boolean {
  return targetsStudent(rule, s) && includes(rule, s.relation === "self" ? "students" : "guardians");
}

/** Staff unit relates to a department-year cohort: it contains the department, or is a section of that year. */
function relatesToYear(unit: OrgNode, dept: OrgNode, year: number): boolean {
  if (isWithin(dept, unit)) return true;
  if (!isWithin(unit, dept)) return false;
  if (unit.type !== "section") return true;
  return parseSectionCode(unit.code)?.year === year;
}

function overlapsStaff(rule: AudienceRule, unit: OrgNode, tree: OrgTree): boolean {
  switch (rule.kind) {
    case "institution":
      return true;
    case "department": {
      const dept = tree.byCode.get(rule.departmentCode);
      return !!dept && overlaps(unit, dept);
    }
    case "section": {
      const section = tree.byCode.get(rule.sectionId);
      return !!section && overlaps(unit, section);
    }
    case "year": {
      const dept = tree.byCode.get(rule.departmentCode);
      return !!dept && relatesToYear(unit, dept, rule.year);
    }
    case "placement_eligible":
      return rule.departmentCodes.some((code) => {
        const dept = tree.byCode.get(code);
        return !!dept && relatesToYear(unit, dept, rule.year);
      });
  }
}

/** Addressed to the viewer: they are one of its recipients. */
export function isAddressedTo(rule: AudienceRule, viewer: Viewer): boolean {
  return (
    (includes(rule, "staff") && viewer.staffUnits.some((u) => overlapsStaff(rule, u, viewer.tree))) ||
    viewer.students.some((s) => matchesLinked(rule, s))
  );
}

/**
 * The viewer's receipt keys for a notice: "u:<user>" as a staff recipient, "s:<student>" for their own record,
 * "g:<student>" for each linked child. Empty when the notice is not addressed to them.
 */
export function recipientKeys(rule: AudienceRule, viewer: Viewer, userId: string): string[] {
  const keys: string[] = [];
  if (includes(rule, "staff") && viewer.staffUnits.some((u) => overlapsStaff(rule, u, viewer.tree)))
    keys.push(`u:${userId}`);
  for (const s of viewer.students)
    if (matchesLinked(rule, s)) keys.push(`${s.relation === "self" ? "s" : "g"}:${s.id}`);
  return keys;
}

/** Visible to the viewer: addressed to them, or (staff) aimed at people inside their scope. */
export function isVisibleTo(rule: AudienceRule, viewer: Viewer): boolean {
  return (
    viewer.staffUnits.some((u) => overlapsStaff(rule, u, viewer.tree)) ||
    viewer.students.some((s) => matchesLinked(rule, s))
  );
}

export function isExpired(a: Pick<Announcement, "expiresAt">, now: Date): boolean {
  return a.expiresAt !== null && new Date(a.expiresAt).getTime() <= now.getTime();
}

const EXAM_CATEGORIES: AnnouncementCategory[] = ["examinations", "results"];
const JOB_CATEGORIES: AnnouncementCategory[] = ["placement", "internships"];
const DAY = 24 * 60 * 60 * 1000;

/** Needs the viewer's attention today: addressed to them and urgent, new, due within a week or awaiting their acknowledgement. */
export function needsAttention(a: InboxItem, now: Date): boolean {
  if (!a.addressed || isExpired(a, now)) return false;
  const age = now.getTime() - new Date(a.publishedAt).getTime();
  const untilDeadline = a.deadline ? new Date(a.deadline).getTime() - now.getTime() : Infinity;
  return (
    a.severity === "critical" ||
    age <= 2 * DAY ||
    (untilDeadline >= 0 && untilDeadline <= 7 * DAY) ||
    (a.requiresAck && !a.acknowledged)
  );
}

export function inView(a: InboxItem, view: InboxView, now: Date): boolean {
  const expired = isExpired(a, now);
  switch (view) {
    case "history":
      return expired;
    case "saved":
      return a.saved;
    case "exams":
      return !expired && EXAM_CATEGORIES.includes(a.category);
    case "jobs":
      return !expired && JOB_CATEGORIES.includes(a.category);
    case "mine":
      return !expired;
    case "today":
      return needsAttention(a, now);
  }
}

const SEVERITY_RANK = { critical: 0, high: 1, normal: 2, low: 3 } as const;

export function sortFeed<T extends Pick<Announcement, "severity" | "publishedAt">>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.publishedAt.localeCompare(a.publishedAt),
  );
}
