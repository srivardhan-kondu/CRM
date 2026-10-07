/**
 * SYNTHETIC org hierarchies for the demo tenants. The seed writes these into `org_unit`; unit tests build
 * in-memory trees from the same specs, so tests and the database describe the same institution.
 */
import type { OrgNode, OrgUnitType } from "@/lib/authz/types";
import { CAMPUSES, DEPARTMENTS, SCHOOLS, SECTIONS } from "./base";

export const DEMO_TENANT = { slug: "demo-university", name: "Demo University Group" } as const;
/** A second, unrelated tenant used to prove cross-tenant isolation. */
export const OTHER_TENANT = { slug: "northfield-college", name: "Northfield College (synthetic)" } as const;

export interface OrgSpec {
  code: string;
  name: string;
  type: OrgUnitType;
  parentCode: string | null;
}

export function demoOrgSpecs(): OrgSpec[] {
  const specs: OrgSpec[] = [{ code: "DUG", name: DEMO_TENANT.name, type: "institution", parentCode: null }];
  for (const c of CAMPUSES)
    specs.push({ code: c.id.toUpperCase(), name: c.name, type: "campus", parentCode: "DUG" });
  for (const s of SCHOOLS)
    specs.push({
      code: s.id.toUpperCase(),
      name: s.name,
      type: "school",
      parentCode: s.campusId.toUpperCase(),
    });
  for (const d of DEPARTMENTS) {
    specs.push({ code: d.code, name: d.name, type: "department", parentCode: d.schoolId.toUpperCase() });
  }
  for (const s of SECTIONS)
    specs.push({ code: s.id, name: `Section ${s.label}`, type: "section", parentCode: s.departmentCode });
  specs.push(
    { code: "EXAM", name: "Office of the Controller of Examinations", type: "office", parentCode: "DUG" },
    { code: "ACCOUNTS", name: "Accounts Office", type: "office", parentCode: "DUG" },
    { code: "PLACEMENT", name: "Placement Cell", type: "office", parentCode: "DUG" },
  );
  return specs;
}

export function otherTenantOrgSpecs(): OrgSpec[] {
  return [
    { code: "NFC", name: OTHER_TENANT.name, type: "institution", parentCode: null },
    { code: "MAIN", name: "Main Campus", type: "campus", parentCode: "NFC" },
    { code: "CSE", name: "Computer Science", type: "department", parentCode: "MAIN" },
    { code: "CSE-3-A", name: "Section 3-CSE-A", type: "section", parentCode: "CSE" },
  ];
}

/** Materialise specs into nodes with paths. `idFor` lets tests use readable ids and the seed use UUIDs. */
export function materialize(specs: readonly OrgSpec[], idFor: (code: string) => string): OrgNode[] {
  const byCode = new Map<string, OrgNode>();
  for (const s of specs) {
    const parent = s.parentCode ? byCode.get(s.parentCode) : undefined;
    if (s.parentCode && !parent) throw new Error(`Parent ${s.parentCode} must precede ${s.code}`);
    const id = idFor(s.code);
    byCode.set(s.code, {
      id,
      parentId: parent?.id ?? null,
      type: s.type,
      code: s.code,
      name: s.name,
      path: `${parent?.path ?? "/"}${id}/`,
      depth: parent ? parent.depth + 1 : 0,
    });
  }
  return [...byCode.values()];
}
