"use client";

import {
  Ban,
  CheckCircle2,
  History,
  Loader2,
  LogOut,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useResultAction } from "@/components/ui/form";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input, Label, Select } from "@/components/ui/input";
import { Avatar } from "@/components/ui/misc";
import type { TenantUserRow, UserAssignmentRow } from "@/domains/admin/queries";
import { cn, formatDate } from "@/lib/utils";
import {
  grantAssignmentAction,
  revokeAssignmentAction,
  revokeSessionsAction,
  setMembershipAction,
} from "./actions";

export interface GrantOptions {
  roles: { id: string; key: string; name: string; linked: boolean; unitIds: string[] }[];
  units: { id: string; label: string; type: string }[];
}

function scopeText(a: UserAssignmentRow) {
  if (a.scopeMode === "linked") return "Linked students";
  const base = a.scopeMode === "unit" ? `${a.orgUnitName} only` : a.orgUnitName;
  return a.courseCodes?.length ? `${base} · ${a.courseCodes.join(", ")}` : base;
}

export function AccessTable({
  users,
  grant,
  currentUserId,
  canManageUsers,
}: {
  users: TenantUserRow[];
  grant: GrantOptions;
  currentUserId: string;
  canManageUsers: boolean;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [grantFor, setGrantFor] = useState<TenantUserRow | null>(null);
  const [revoking, setRevoking] = useState<{ user: TenantUserRow; assignment: UserAssignmentRow } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  const runUserAction = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message);
      else toast.error(r.error);
    });

  return (
    <div className="border-border bg-surface rounded-lg border shadow-xs">
      <div className="border-border flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <p className="text-muted text-xs">
          {users.length} user{users.length === 1 ? "" : "s"} · changes apply on each user&apos;s next request
        </p>
        <label className="text-muted flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={showHistory}
            onChange={(e) => setShowHistory(e.target.checked)}
            className="accent-[var(--brand)]"
          />
          <History aria-hidden className="size-3.5" /> Show revoked
        </label>
      </div>
      <ul className="divide-border divide-y">
        {users.map((u) => {
          const assignments = u.assignments.filter((a) => showHistory || !a.revokedAt);
          const isSelf = u.userId === currentUserId;
          return (
            <li
              key={u.userId}
              className={cn(
                "flex flex-col gap-3 px-4 py-3 md:flex-row md:items-start",
                pending && "opacity-70",
              )}
            >
              <div className="flex min-w-0 items-center gap-3 md:w-72 md:shrink-0">
                <Avatar name={u.name} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {u.name} {isSelf && <span className="text-subtle text-2xs font-normal">(you)</span>}
                  </p>
                  <p className="text-muted truncate text-xs">{u.email}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {u.status === "suspended" ? (
                      <Badge tone="danger">
                        <Ban aria-hidden /> Suspended
                      </Badge>
                    ) : (
                      <Badge tone="success">
                        <CheckCircle2 aria-hidden /> Active
                      </Badge>
                    )}
                    <Badge tone="outline">
                      {u.signIn === "google"
                        ? "Google linked"
                        : u.signIn === "password"
                          ? "Demo password"
                          : "Hasn't signed in"}
                    </Badge>
                    {u.activeSessions > 0 && (
                      <Badge tone="info">
                        {u.activeSessions} session{u.activeSessions === 1 ? "" : "s"}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="min-w-0 flex-1">
                {u.teaching.length > 0 && (
                  <p className="text-muted mb-1.5 text-xs">
                    Teaches {u.teaching.join(", ")} this term. That access follows allocation — change it
                    under Courses.
                  </p>
                )}
                {assignments.length === 0 ? (
                  u.teaching.length === 0 && (
                    <p className="text-muted py-1 text-sm">
                      No roles — this user can sign in but sees nothing.
                    </p>
                  )
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {assignments.map((a) => (
                      <li
                        key={a.id}
                        className={cn(
                          "border-border flex max-w-full items-center gap-2 rounded-md border px-2 py-1 text-xs",
                          a.revokedAt && "bg-surface-muted opacity-60",
                        )}
                        title={a.revokedAt ? `Revoked: ${a.revokeReason ?? ""}` : undefined}
                      >
                        <ShieldCheck aria-hidden className="text-brand size-3.5 shrink-0" />
                        <span className="min-w-0">
                          <span className={cn("font-medium", a.revokedAt && "line-through")}>
                            {a.roleName}
                          </span>
                          <span className="text-muted"> · {scopeText(a)}</span>
                          {(a.validTo || a.revokedAt) && (
                            <span className="text-subtle">
                              {" "}
                              ·{" "}
                              {a.revokedAt
                                ? `revoked ${formatDate(new Date(a.revokedAt).toISOString())}`
                                : `until ${formatDate(a.validTo!)}`}
                            </span>
                          )}
                        </span>
                        {a.manageable && (
                          <button
                            type="button"
                            onClick={() => setRevoking({ user: u, assignment: a })}
                            className="text-subtle hover:bg-danger-soft hover:text-danger -mr-1 rounded p-0.5"
                            aria-label={`Revoke ${a.roleName} from ${u.name}`}
                          >
                            <X className="size-3.5" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {!isSelf && (
                <div className="flex shrink-0 items-center gap-1">
                  {grant.roles.length > 0 && u.status === "active" && (
                    <Button variant="secondary" size="sm" onClick={() => setGrantFor(u)}>
                      <Plus /> Grant role
                    </Button>
                  )}
                  {canManageUsers && u.manageable && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${u.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem
                          disabled={u.activeSessions === 0}
                          onSelect={() => runUserAction(() => revokeSessionsAction(u.userId))}
                        >
                          <LogOut /> Sign out everywhere
                        </DropdownMenuItem>
                        {u.status === "active" ? (
                          <DropdownMenuItem
                            className="text-danger"
                            onSelect={() => {
                              if (
                                confirm(
                                  `Suspend ${u.email}? They are signed out immediately and lose all access.`,
                                )
                              ) {
                                runUserAction(() => setMembershipAction(u.userId, "suspended"));
                              }
                            }}
                          >
                            <Ban /> Suspend access
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onSelect={() => runUserAction(() => setMembershipAction(u.userId, "active"))}
                          >
                            <CheckCircle2 /> Reactivate
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog open={grantFor !== null} onOpenChange={(o) => !o && setGrantFor(null)}>
        {grantFor && <GrantForm user={grantFor} options={grant} onDone={() => setGrantFor(null)} />}
      </Dialog>
      <Dialog open={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)}>
        {revoking && <RevokeForm {...revoking} onDone={() => setRevoking(null)} />}
      </Dialog>
    </div>
  );
}

function GrantForm({
  user,
  options,
  onDone,
}: {
  user: TenantUserRow;
  options: GrantOptions;
  onDone: () => void;
}) {
  const [state, action, pending] = useResultAction(grantAssignmentAction, onDone);
  const [roleId, setRoleId] = useState(options.roles[0]?.id ?? "");
  const role = options.roles.find((r) => r.id === roleId);
  const units = useMemo(
    () => options.units.filter((u) => role?.unitIds.includes(u.id)),
    [options.units, role],
  );
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const unit = units.find((u) => u.id === unitId) ?? units[0];
  const isFaculty = role?.key === "faculty";

  return (
    <DialogContent
      title={`Grant a role to ${user.name}`}
      description="The role applies to the selected part of the institution and everything beneath it."
    >
      <form action={action} className="space-y-4">
        <input type="hidden" name="userId" value={user.userId} />
        <input
          type="hidden"
          name="scopeMode"
          value={role?.linked ? "linked" : isFaculty ? "unit" : "subtree"}
        />
        <div className="space-y-1.5">
          <Label htmlFor="grant-role">Role</Label>
          <Select
            id="grant-role"
            name="roleId"
            value={roleId}
            onChange={(e) => {
              setRoleId(e.target.value);
              const next = options.roles.find((r) => r.id === e.target.value);
              setUnitId(options.units.find((u) => next?.unitIds.includes(u.id))?.id ?? "");
            }}
          >
            {options.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
          <p className="text-subtle text-2xs">Only roles whose permissions you hold yourself are offered.</p>
        </div>
        {role?.linked ? (
          <>
            <input type="hidden" name="orgUnitId" value={units[0]?.id ?? ""} />
            <div className="space-y-1.5">
              <Label htmlFor="grant-student">Student number</Label>
              <Input
                id="grant-student"
                name="studentNumber"
                required
                placeholder="24CSE001"
                className="font-mono uppercase"
              />
              <p className="text-subtle text-2xs">
                {role.key === "parent"
                  ? "The parent will see this student's progress, fees and notices."
                  : "The student will see only their own record."}
              </p>
            </div>
          </>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="grant-unit">Scope</Label>
            <Select
              id="grant-unit"
              name="orgUnitId"
              value={unit?.id ?? ""}
              onChange={(e) => setUnitId(e.target.value)}
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label.replace(/ /g, " ")}
                </option>
              ))}
            </Select>
          </div>
        )}
        {isFaculty && (
          <div className="space-y-1.5">
            <Label htmlFor="grant-courses">Courses taught in this section</Label>
            <Input
              id="grant-courses"
              name="courseCodes"
              placeholder="CS301, CS302"
              className="font-mono uppercase"
            />
            <p className="text-subtle text-2xs">
              Faculty see attendance only for these courses. Course offerings replace this in Phase 2.
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="grant-from">Valid from</Label>
            <Input id="grant-from" name="validFrom" type="date" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="grant-to">Valid until (optional)</Label>
            <Input id="grant-to" name="validTo" type="date" />
          </div>
        </div>
        {state && !state.ok && (
          <p role="alert" className="bg-danger-soft text-danger-soft-foreground rounded-md px-3 py-2 text-sm">
            {state.error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !role}>
            {pending && <Loader2 className="animate-spin" />} Grant role
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

function RevokeForm({
  user,
  assignment,
  onDone,
}: {
  user: TenantUserRow;
  assignment: UserAssignmentRow;
  onDone: () => void;
}) {
  const [state, action, pending] = useResultAction(revokeAssignmentAction, onDone);
  return (
    <DialogContent
      title={`Revoke ${assignment.roleName}?`}
      description={`${user.name} loses ${assignment.roleName} on ${scopeText(assignment)} from their next request. The assignment is kept in history.`}
    >
      <form action={action} className="space-y-4">
        <input type="hidden" name="assignmentId" value={assignment.id} />
        <div className="space-y-1.5">
          <Label htmlFor="revoke-reason">Reason</Label>
          <Input
            id="revoke-reason"
            name="reason"
            required
            minLength={3}
            placeholder="e.g. Moved to ECE department"
          />
        </div>
        {state && !state.ok && (
          <p role="alert" className="bg-danger-soft text-danger-soft-foreground rounded-md px-3 py-2 text-sm">
            {state.error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Revoke
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
