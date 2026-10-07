export type OrgUnitType = "institution" | "campus" | "school" | "department" | "section" | "office";

export interface OrgNode {
  id: string;
  parentId: string | null;
  type: OrgUnitType;
  code: string;
  name: string;
  /** "/<root id>/…/<own id>/" */
  path: string;
  depth: number;
}

export interface OrgTree {
  tenantId: string;
  root: OrgNode;
  byId: ReadonlyMap<string, OrgNode>;
  byCode: ReadonlyMap<string, OrgNode>;
}

export type ScopeMode = "subtree" | "unit" | "linked";

/** An active (not revoked, in-date) role assignment with its permissions resolved. */
export interface Assignment {
  id: string;
  roleKey: string;
  roleName: string;
  rank: number;
  permissions: ReadonlySet<string>;
  orgUnitId: string;
  scopeMode: ScopeMode;
  courseCodes: readonly string[] | null;
  /** "teaching" when derived from a current-term teaching allocation rather than granted (teaching.ts). */
  source?: "teaching";
}

export interface StudentLinkRef {
  studentNumber: string;
  relation: "self" | "guardian";
}

/**
 * Everything authorization needs about the current user in one tenant, loaded once per request.
 * Only active memberships, unrevoked and in-date assignments are included — removal takes effect on the next request.
 */
export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  image: string | null;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  assignments: readonly Assignment[];
  links: readonly StudentLinkRef[];
  /** The assignment whose workspace (navigation, dashboard) is shown. Null when the user has no roles. */
  active: Assignment | null;
}

/** Minimal shape of a student the engine needs: tenant, roll number and the section (org unit code) they sit in. */
export interface StudentRef {
  tenantId: string;
  studentNumber: string;
  sectionCode: string;
}

export type Resource =
  | { kind: "student"; student: StudentRef }
  | { kind: "org_unit"; tenantId: string; orgUnitId: string }
  | { kind: "tenant"; tenantId: string };

export interface Decision {
  allowed: boolean;
  reason: string;
  /** Assignments that granted the permission (empty when denied). */
  via: string[];
}
