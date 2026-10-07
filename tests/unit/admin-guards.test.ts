import { describe, expect, it } from "vitest";
import { canGrant, canManageUser, canRevoke } from "@/domains/admin/guards";
import { ROLE_DEFINITIONS, roleDefinition } from "@/lib/authz/catalogue";
import { ctxFor, demoTree } from "../helpers/demo-authz";

const perms = (role: string) => new Set(roleDefinition(role)!.permissions);
const unit = (code: string) => demoTree.byCode.get(code)!.id;

describe("role catalogue invariants", () => {
  it("lets the principal delegate every role except Super Admin (ceiling covers them)", () => {
    const principalPerms = perms("principal");
    for (const r of ROLE_DEFINITIONS.filter((x) => x.key !== "super_admin")) {
      const missing = r.permissions.filter((p) => !principalPerms.has(p));
      expect(missing, `principal lacks ${missing.join(", ")} held by ${r.key}`).toEqual([]);
    }
  });

  it("lets the Super Admin delegate every role", () => {
    const sa = perms("super_admin");
    for (const r of ROLE_DEFINITIONS) expect(r.permissions.every((p) => sa.has(p))).toBe(true);
  });

  it("pairs cohort academics with course-level attendance in every role", () => {
    for (const r of ROLE_DEFINITIONS) {
      if (r.permissions.includes("student.academic:read"))
        expect(r.permissions).toContain("student.course_attendance:read");
    }
  });
});

describe("privilege escalation guards", () => {
  const principal = ctxFor("principal");

  it("lets the principal grant HOD on a department", () => {
    expect(
      canGrant(principal, demoTree, {
        targetUserId: "u1",
        orgUnitId: unit("ECE"),
        scopeMode: "subtree",
        rolePermissions: perms("hod"),
      }),
    ).toEqual({ ok: true });
  });

  it("stops the principal minting a Super Admin (role exceeds their own permissions)", () => {
    const r = canGrant(principal, demoTree, {
      targetUserId: "u1",
      orgUnitId: unit("DUG"),
      scopeMode: "subtree",
      rolePermissions: perms("super_admin"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/permissions you don't hold/);
  });

  it("stops anyone granting themselves anything", () => {
    const sa = ctxFor("super_admin");
    expect(
      canGrant(sa, demoTree, {
        targetUserId: sa.userId,
        orgUnitId: unit("CSE"),
        scopeMode: "subtree",
        rolePermissions: perms("hod"),
      }).ok,
    ).toBe(false);
  });

  it("denies roles without role_assignment:manage (HOD, class incharge, student)", () => {
    for (const key of ["hod_cse", "class_incharge", "student"]) {
      expect(
        canGrant(ctxFor(key), demoTree, {
          targetUserId: "u1",
          orgUnitId: unit("CSE-3-A"),
          scopeMode: "subtree",
          rolePermissions: perms("faculty"),
        }).ok,
      ).toBe(false);
    }
  });

  it("anchors linked roles at the institution", () => {
    expect(
      canGrant(principal, demoTree, {
        targetUserId: "u1",
        orgUnitId: unit("CSE"),
        scopeMode: "linked",
        rolePermissions: perms("student"),
      }).ok,
    ).toBe(false);
    expect(
      canGrant(principal, demoTree, {
        targetUserId: "u1",
        orgUnitId: unit("DUG"),
        scopeMode: "linked",
        rolePermissions: perms("student"),
      }).ok,
    ).toBe(true);
  });

  it("rejects units outside the tenant", () => {
    expect(
      canGrant(principal, demoTree, {
        targetUserId: "u1",
        orgUnitId: "nf-CSE",
        scopeMode: "subtree",
        rolePermissions: perms("hod"),
      }).ok,
    ).toBe(false);
  });

  it("stops the principal revoking a Super Admin's assignment, but allows revoking an HOD", () => {
    expect(
      canRevoke(principal, demoTree, {
        targetUserId: "sa",
        orgUnitId: unit("DUG"),
        rolePermissions: perms("super_admin"),
      }).ok,
    ).toBe(false);
    expect(
      canRevoke(principal, demoTree, {
        targetUserId: "h",
        orgUnitId: unit("CSE"),
        rolePermissions: perms("hod"),
      }).ok,
    ).toBe(true);
    expect(
      canRevoke(principal, demoTree, {
        targetUserId: principal.userId,
        orgUnitId: unit("CSE"),
        rolePermissions: perms("hod"),
      }).ok,
    ).toBe(false);
  });

  it("only lets an administrator suspend users who are not more senior", () => {
    const hodTarget = { userId: "h", assignments: [{ orgUnitId: unit("CSE"), permissions: perms("hod") }] };
    const saTarget = {
      userId: "sa",
      assignments: [{ orgUnitId: unit("DUG"), permissions: perms("super_admin") }],
    };
    expect(canManageUser(principal, demoTree, hodTarget).ok).toBe(true);
    expect(canManageUser(principal, demoTree, saTarget).ok).toBe(false);
    expect(canManageUser(ctxFor("super_admin"), demoTree, saTarget).ok).toBe(true);
    expect(canManageUser(ctxFor("hod_cse"), demoTree, hodTarget).ok).toBe(false);
  });
});
