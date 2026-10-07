import type { Assignment, OrgTree } from "./types";

/** Human scope label for an assignment, e.g. "CSE department", "Section 3-CSE-A · CS301", "Own record". */
export function describeAssignmentScope(a: Assignment, tree: OrgTree): string {
  if (a.scopeMode === "linked") return a.roleKey === "parent" ? "Linked student" : "Own record";
  const unit = tree.byId.get(a.orgUnitId);
  if (!unit) return "Unknown scope";
  const base =
    unit.type === "institution"
      ? "Institution-wide"
      : unit.type === "department"
        ? `${unit.code} department`
        : unit.name;
  const scope = a.courseCodes?.length ? `${base} · ${a.courseCodes.join(", ")}` : base;
  return a.source === "teaching" ? `${scope} (teaching)` : scope;
}
