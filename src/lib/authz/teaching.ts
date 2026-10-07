import type { Assignment } from "./types";

/** One active teaching allocation in the current term: a course taught to a section. */
export interface TeachingRef {
  sectionId: string;
  /** Human section code (e.g. CSE-3-A): orders assignments stably, since section ids are random. */
  sectionCode: string;
  courseCode: string;
}

export interface FacultyRole {
  key: string;
  name: string;
  rank: number;
  permissions: ReadonlySet<string>;
}

export const TEACHING_ASSIGNMENT_PREFIX = "teaching:";

/**
 * Teaching access derives from allocation, not from a separately granted role: each section a user teaches in
 * the current term becomes one unit-scoped assignment carrying the tenant's faculty-role permissions and the
 * courses taught there. Removing the allocation removes the access on the next request, and there is nothing
 * to forget to revoke.
 */
export function deriveTeachingAssignments(refs: readonly TeachingRef[], role: FacultyRole): Assignment[] {
  const bySection = new Map<string, { sectionCode: string; codes: Set<string> }>();
  for (const r of refs) {
    const entry = bySection.get(r.sectionId) ?? { sectionCode: r.sectionCode, codes: new Set<string>() };
    entry.codes.add(r.courseCode);
    bySection.set(r.sectionId, entry);
  }
  return [...bySection.entries()]
    .sort(([, a], [, b]) => a.sectionCode.localeCompare(b.sectionCode))
    .map(([sectionId, { codes }]) => ({
      id: `${TEACHING_ASSIGNMENT_PREFIX}${sectionId}`,
      roleKey: role.key,
      roleName: role.name,
      rank: role.rank,
      permissions: role.permissions,
      orgUnitId: sectionId,
      scopeMode: "unit",
      courseCodes: [...codes].sort(),
      source: "teaching",
    }));
}
