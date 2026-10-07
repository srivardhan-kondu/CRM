import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db/client";
import { getAuth } from "@/lib/auth/auth";
import { loadAuthContext, loadMemberships, loadOrgTree } from "./load";
import type { AuthContext, OrgTree } from "./types";

export const TENANT_COOKIE = "campusos_tenant";
export const WORKSPACE_COOKIE = "campusos_workspace";

/** The authenticated identity (Better Auth session), or null. */
export const getIdentity = cache(async () => {
  const requestHeaders = await headers(); // read first: marks the route dynamic before any config can throw
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  return session
    ? { userId: session.user.id, email: session.user.email, sessionId: session.session.id }
    : null;
});

/** AuthContext for the current request — loaded once, then shared by every server component and action. */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const identity = await getIdentity();
  if (!identity) return null;
  const jar = await cookies();
  return loadAuthContext(getDb(), identity.userId, {
    tenantId: jar.get(TENANT_COOKIE)?.value,
    activeAssignmentId: jar.get(WORKSPACE_COOKIE)?.value,
  });
});

export const getOrgTree = cache(async (tenantId: string): Promise<OrgTree> => loadOrgTree(getDb(), tenantId));

export const getMemberships = cache(async (userId: string) => loadMemberships(getDb(), userId));

export interface Authed {
  ctx: AuthContext;
  tree: OrgTree;
}

/**
 * Gate for every authenticated page and action. No session → /login. Session but no active membership →
 * /login with an explanation (the user is signed in but has no access to any institution).
 */
export async function requireAuth(): Promise<Authed> {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login?error=no_membership");
  return { ctx, tree: await getOrgTree(ctx.tenantId) };
}

/** For server actions / route handlers: same checks, but returns null instead of redirecting. */
export async function currentAuth(): Promise<Authed | null> {
  const ctx = await getAuthContext();
  if (!ctx) return null;
  return { ctx, tree: await getOrgTree(ctx.tenantId) };
}
