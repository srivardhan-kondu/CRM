import { GraduationCap, LayoutDashboard, ShieldCheck, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/authz/context";
import { roleDefinition } from "@/lib/authz/catalogue";
import { SEED_USERS } from "@/lib/demo/personas";
import { demoModeEnabled, googleConfigured } from "@/lib/env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };
// Provider availability and demo mode are runtime settings.
export const dynamic = "force-dynamic";

const PROMISES = [
  {
    icon: UsersRound,
    title: "One student record",
    body: "Academics, attendance, fees, mentoring and notices around a single Student 360.",
  },
  {
    icon: ShieldCheck,
    title: "Hierarchy-aware access",
    body: "Everyone sees exactly what their role and scope permit — enforced on the server.",
  },
  {
    icon: LayoutDashboard,
    title: "Decisions, not tables",
    body: "Dashboards that surface what is abnormal and what to do next.",
  },
];

const ERRORS: Record<string, string> = {
  signup_disabled:
    "That Google account isn't registered with CampusOS. Ask your administrator to invite the exact email address you signed in with.",
  account_not_linked:
    "We couldn't link that Google account to your CampusOS user. Contact your administrator.",
  unable_to_link_account:
    "We couldn't link that Google account to your CampusOS user. Contact your administrator.",
  no_membership:
    "You're signed in, but your access to this institution is suspended or hasn't been set up yet.",
  access_denied: "Google sign-in was cancelled.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  // Already signed in with access → straight to the workspace.
  if (!error && (await getAuthContext())) redirect("/dashboard");

  const demo = demoModeEnabled();
  const personas = demo
    ? SEED_USERS.filter((u) => u.persona).map((u) => {
        // A persona with no granted role gets all its access from teaching allocations (Phase 2).
        const roleKey = u.assignments[0]?.role ?? "faculty";
        return {
          email: u.email,
          name: u.name,
          title: u.title,
          role: roleDefinition(roleKey)?.name ?? roleKey,
          tenant: u.tenantSlug === "demo-university" ? "Demo University" : "Northfield",
        };
      })
    : [];

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-[oklch(0.24_0.06_266)] p-10 text-white lg:flex lg:flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 -right-32 size-[520px] rounded-full bg-[radial-gradient(circle,oklch(0.55_0.2_266/0.55),transparent_65%)]"
        />
        <div className="relative flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-md bg-white/15">
            <GraduationCap aria-hidden className="size-4.5" />
          </span>
          <span className="text-lg font-semibold tracking-tight">CampusOS</span>
        </div>
        <div className="relative mt-auto max-w-md">
          <h1 className="text-3xl leading-tight font-semibold tracking-tight">
            The operating system for your college.
          </h1>
          <p className="mt-3 text-sm text-white/70">
            One authoritative student record, one permission model, one command center — from the
            principal&apos;s office to the classroom.
          </p>
          <ul className="mt-8 space-y-5">
            {PROMISES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-white/10">
                  <Icon aria-hidden className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-sm text-white/65">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-10 text-xs text-white/50">
          Demo University Group · synthetic demonstration data
        </p>
      </aside>

      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="bg-brand text-brand-foreground flex size-8 items-center justify-center rounded-md">
              <GraduationCap aria-hidden className="size-4.5" />
            </span>
            <span className="text-lg font-semibold tracking-tight">CampusOS</span>
          </div>
          <h2 className="text-xl font-semibold tracking-tight">Sign in to CampusOS</h2>
          <p className="text-muted mt-1 text-sm">
            Use the Google account your institution registered for you.
          </p>
          {error && (
            <p
              role="alert"
              className="bg-danger-soft text-danger-soft-foreground mt-4 rounded-md px-3 py-2 text-sm"
            >
              {ERRORS[error] ?? "Sign-in didn't complete. Please try again."}
            </p>
          )}
          <LoginForm googleEnabled={googleConfigured()} personas={personas} />
        </div>
      </main>
    </div>
  );
}
