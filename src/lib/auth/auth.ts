import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { appUser, authAccount, authSession, authVerification, tenantMembership } from "@/db/schema";
import { recordAudit } from "@/lib/audit/record";
import { demoModeEnabled, env, googleConfigured } from "@/lib/env";

/**
 * Better Auth (ADR-009). Identity only: who the user is and whether their session is valid.
 * What they may do is decided by the CampusOS policy engine from tenant memberships and role assignments.
 *
 * - No self sign-up. Users are provisioned by an administrator; Google sign-in links to the provisioned,
 *   verified address and is rejected for unknown emails.
 * - Sessions live in Postgres with no cookie cache, so revoking a session or suspending a membership takes
 *   effect on the very next request.
 * - Password sign-in exists only for synthetic demo personas, and only when CAMPUSOS_DEMO_MODE=true.
 */
async function emailOf(userId: string): Promise<string | null> {
  const [row] = await getDb().select({ email: appUser.email }).from(appUser).where(eq(appUser.id, userId));
  return row?.email ?? null;
}

function createAuth() {
  const e = env();
  return betterAuth({
    appName: "CampusOS",
    secret: e.BETTER_AUTH_SECRET,
    baseURL: e.BETTER_AUTH_URL,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        app_user: appUser,
        auth_session: authSession,
        auth_account: authAccount,
        auth_verification: authVerification,
      },
    }),
    user: { modelName: "app_user" },
    session: {
      modelName: "auth_session",
      expiresIn: 60 * 60 * 12,
      updateAge: 60 * 60,
      cookieCache: { enabled: false },
    },
    account: {
      modelName: "auth_account",
      accountLinking: { enabled: true, trustedProviders: ["google"], allowDifferentEmails: false },
    },
    verification: { modelName: "auth_verification" },
    advanced: {
      cookiePrefix: "campusos",
      database: { generateId: "uuid" },
    },
    emailAndPassword: { enabled: demoModeEnabled(), disableSignUp: true },
    socialProviders: googleConfigured()
      ? {
          google: {
            clientId: e.GOOGLE_CLIENT_ID!,
            clientSecret: e.GOOGLE_CLIENT_SECRET!,
            disableSignUp: true,
            prompt: "select_account",
          },
        }
      : {},
    onAPIError: {
      errorURL: "/login",
      onError: async (error) => {
        await recordAudit({
          tenantId: null,
          actorUserId: null,
          action: "auth.error",
          outcome: "failure",
          reason: error instanceof Error ? error.message : String(error),
        }).catch(() => {});
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Defense in depth alongside disableSignUp: identities are only ever created by provisioning.
          before: async (user) => {
            await recordAudit({
              tenantId: null,
              actorUserId: null,
              actorEmail: user.email,
              action: "auth.sign_up",
              outcome: "denied",
              reason: "self sign-up is disabled; user is not provisioned",
            });
            return false;
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const active = await getDb()
              .select({ tenantId: tenantMembership.tenantId })
              .from(tenantMembership)
              .where(and(eq(tenantMembership.userId, session.userId), eq(tenantMembership.status, "active")))
              .limit(1);
            if (active.length === 0) {
              await recordAudit({
                tenantId: null,
                actorUserId: session.userId,
                actorEmail: await emailOf(session.userId),
                action: "auth.sign_in",
                outcome: "denied",
                reason: "no active tenant membership",
              });
              return false;
            }
          },
          after: async (session, ctx) => {
            await recordAudit({
              tenantId: null,
              actorUserId: session.userId,
              actorEmail: await emailOf(session.userId),
              action: "auth.sign_in",
              outcome: "success",
              metadata: { via: ctx?.path ?? "unknown" },
            });
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

let instance: ReturnType<typeof createAuth> | null = null;

export function getAuth() {
  if (!instance) instance = createAuth();
  return instance;
}
