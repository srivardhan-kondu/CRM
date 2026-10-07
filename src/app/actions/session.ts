"use server";

import { APIError } from "better-auth/api";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { recordAudit } from "@/lib/audit/record";
import { getAuth } from "@/lib/auth/auth";
import { demoPasswordFor } from "@/lib/auth/demo-password";
import {
  getAuthContext,
  getIdentity,
  getMemberships,
  TENANT_COOKIE,
  WORKSPACE_COOKIE,
} from "@/lib/authz/context";
import { SEED_USERS } from "@/lib/demo/personas";
import { demoModeEnabled, env } from "@/lib/env";

export interface SignInState {
  error?: string;
}

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

const personaEmails = SEED_USERS.filter((u) => u.persona).map((u) => u.email.toLowerCase()) as [
  string,
  ...string[],
];
const personaSchema = z.object({ email: z.enum(personaEmails) });

/**
 * Demo sign-in: a real Better Auth password sign-in for a seeded synthetic persona, using a password derived
 * from the deployment secret. Same session, cookies and audit trail as any other sign-in. Off unless
 * CAMPUSOS_DEMO_MODE=true (and refused in production by env validation).
 */
export async function signInAsPersona(_prev: SignInState, formData: FormData): Promise<SignInState> {
  if (!demoModeEnabled()) return { error: "Demo accounts are disabled in this environment." };
  const parsed = personaSchema.safeParse({ email: String(formData.get("email") ?? "").toLowerCase() });
  if (!parsed.success) return { error: "Choose one of the demo accounts to continue." };

  try {
    await getAuth().api.signInEmail({
      body: {
        email: parsed.data.email,
        password: demoPasswordFor(parsed.data.email, env().BETTER_AUTH_SECRET),
      },
      headers: await headers(),
    });
  } catch (err) {
    const message = err instanceof APIError ? err.message : "Sign-in failed.";
    return { error: `${message} If this persists, re-run the seed: npm run db:seed.` };
  }
  const jar = await cookies();
  jar.delete(WORKSPACE_COOKIE);
  jar.delete(TENANT_COOKIE);
  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  const identity = await getIdentity();
  const ctx = await getAuthContext();
  await getAuth().api.signOut({ headers: await headers() });
  if (identity) {
    await recordAudit({
      tenantId: ctx?.tenantId ?? null,
      actorUserId: identity.userId,
      actorEmail: identity.email,
      action: "auth.sign_out",
      outcome: "success",
    });
  }
  const jar = await cookies();
  jar.delete(WORKSPACE_COOKIE);
  jar.delete(TENANT_COOKIE);
  redirect("/login");
}

/** Switch the active workspace to another of the user's own active assignments. Anything else is ignored. */
export async function switchWorkspace(assignmentId: string): Promise<void> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (ctx.assignments.some((a) => a.id === assignmentId)) {
    (await cookies()).set(WORKSPACE_COOKIE, assignmentId, COOKIE_OPTS);
  }
  redirect("/dashboard");
}

/** Switch institution, only to one where the user has an active membership. */
export async function switchTenant(tenantId: string): Promise<void> {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  const memberships = await getMemberships(identity.userId);
  if (memberships.some((m) => m.tenantId === tenantId)) {
    const jar = await cookies();
    jar.set(TENANT_COOKIE, tenantId, COOKIE_OPTS);
    jar.delete(WORKSPACE_COOKIE);
  }
  redirect("/dashboard");
}
