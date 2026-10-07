import { descendantsOfType } from "@/lib/authz/org-tree";
import type { AuthContext, OrgTree } from "@/lib/authz/types";

/**
 * Which rows are worth loading for this user: the sections their `student:view` assignments reach, plus their
 * linked students. This only narrows the SQL query — every loaded row still goes through the policy engine,
 * which stays the authority on access.
 */
export interface StudentScope {
  all: boolean;
  sectionIds: string[];
  studentNumbers: string[];
}

export function studentScope(ctx: AuthContext, tree: OrgTree): StudentScope {
  const sections = new Set<string>();
  const numbers = new Set<string>();
  for (const a of ctx.assignments) {
    if (!a.permissions.has("student:view")) continue;
    if (a.scopeMode === "linked") {
      const relation = a.roleKey === "parent" ? "guardian" : "self";
      for (const l of ctx.links) if (l.relation === relation) numbers.add(l.studentNumber);
      continue;
    }
    const unit = tree.byId.get(a.orgUnitId);
    if (!unit) continue;
    if (a.scopeMode === "subtree" && unit.id === tree.root.id)
      return { all: true, sectionIds: [], studentNumbers: [] };
    if (unit.type === "section") sections.add(unit.id);
    else if (a.scopeMode === "subtree")
      for (const s of descendantsOfType(tree, unit, "section")) sections.add(s.id);
  }
  return { all: false, sectionIds: [...sections].sort(), studentNumbers: [...numbers].sort() };
}

export const scopeKey = (s: StudentScope) =>
  s.all ? "*" : `${s.sectionIds.join(",")}|${s.studentNumbers.join(",")}`;

export function parseScopeKey(key: string): StudentScope {
  if (key === "*") return { all: true, sectionIds: [], studentNumbers: [] };
  const [sections = "", numbers = ""] = key.split("|");
  return {
    all: false,
    sectionIds: sections ? sections.split(",") : [],
    studentNumbers: numbers ? numbers.split(",") : [],
  };
}

/** Year of study and semester a batch is in during a term (two terms per academic year). */
export function placementInTerm(
  admissionYear: number,
  academicYearStart: number,
  kind: "odd" | "even" | "summer",
) {
  const year = Math.max(1, academicYearStart - admissionYear + 1);
  return { year, semester: (year - 1) * 2 + (kind === "even" ? 2 : 1) };
}
