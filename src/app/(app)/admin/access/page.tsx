import { KeyRound, Search, UserX } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState, PermissionState } from "@/components/patterns/states";
import { Input } from "@/components/ui/input";
import { listGrantableRoles, listTenantUsers } from "@/domains/admin/queries";
import { canGrant } from "@/domains/admin/guards";
import { requireAuth } from "@/lib/authz/context";
import { canManageAssignmentsAt, holdsAnywhere } from "@/lib/authz/engine";
import { depthFirst } from "@/lib/authz/org-tree";
import { AccessTable, type GrantOptions } from "./access-table";
import { InviteUserButton } from "./invite-dialog";

export const metadata: Metadata = { title: "Users & access" };

export default async function AccessPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const authed = await requireAuth();
  const { ctx, tree } = authed;
  const { q } = await searchParams;
  const users = await listTenantUsers(authed, q);

  if (users === null) {
    return (
      <div className="border-border bg-surface rounded-lg border py-12 shadow-xs">
        <PermissionState description="Managing users and role assignments isn't part of your role. Ask an administrator if you need access changed." />
      </div>
    );
  }

  // What this administrator may grant, and where — computed on the server from the same guard the action uses.
  const roles = await listGrantableRoles(authed);
  const manageableUnits = depthFirst(tree).filter((u) => canManageAssignmentsAt(ctx, tree, u.id));
  const grant: GrantOptions = {
    roles: roles
      .map((r) => {
        const linked = r.key === "student" || r.key === "parent";
        const unitIds = manageableUnits
          .filter(
            (u) =>
              canGrant(ctx, tree, {
                targetUserId: "",
                orgUnitId: u.id,
                scopeMode: linked ? "linked" : "subtree",
                rolePermissions: r.permissions,
              }).ok,
          )
          .map((u) => u.id);
        return { id: r.id, key: r.key, name: r.name, linked, unitIds };
      })
      .filter((r) => r.unitIds.length > 0),
    units: manageableUnits.map((u) => ({
      id: u.id,
      label: `${"  ".repeat(u.depth)}${u.name}`,
      type: u.type,
    })),
  };

  return (
    <>
      <PageHeader
        title="Users & access"
        description={`Who can sign in to ${ctx.tenantName}, what role they hold, and where. Every change is audited.`}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administration" },
          { label: "Users & access" },
        ]}
        actions={holdsAnywhere(ctx, "user:manage") ? <InviteUserButton /> : undefined}
      />
      <form className="relative mb-3 max-w-sm" role="search">
        <Search
          aria-hidden
          className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        <Input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by name or email"
          aria-label="Search users"
          className="pl-9"
        />
      </form>
      {users.length === 0 ? (
        <div className="border-border bg-surface rounded-lg border shadow-xs">
          <EmptyState
            icon={q ? UserX : KeyRound}
            title={q ? "No matching users" : "No users in your scope yet"}
            description={q ? "Try a different name or email." : "Invite someone to get started."}
          />
        </div>
      ) : (
        <AccessTable
          users={users}
          grant={grant}
          currentUserId={ctx.userId}
          canManageUsers={holdsAnywhere(ctx, "user:manage")}
        />
      )}
    </>
  );
}
