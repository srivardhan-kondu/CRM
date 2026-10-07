import { ArrowRight, Construction } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NAV_ICONS } from "@/components/shell/icons";
import { PageHeader } from "@/components/patterns/page-header";
import { PermissionState } from "@/components/patterns/states";
import { Button } from "@/components/ui/button";
import { workspaceFor } from "@/lib/authz/catalogue";
import { requireAuth } from "@/lib/authz/context";
import { CURRENT_PHASE, findModuleByPath, isAvailable, type ModuleKey } from "@/lib/navigation/modules";
import { workspaceHasModule } from "@/lib/navigation/nav";

type Props = { params: Promise<{ slug: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: findModuleByPath(`/${slug.join("/")}`)?.label ?? "Not found" };
}

/**
 * Planned modules: every navigation entry resolves to a real page that says honestly when it arrives,
 * instead of a fake screen. Real routes added in later phases take precedence over this catch-all.
 */
export default async function PlannedModulePage({ params }: Props) {
  const { ctx } = await requireAuth();
  const { slug } = await params;
  const mod = findModuleByPath(`/${slug.join("/")}`);
  if (!mod || isAvailable(mod)) notFound();

  if (!ctx.active || !workspaceHasModule(workspaceFor(ctx.active.roleKey), mod.key as ModuleKey)) {
    return (
      <div className="border-border bg-surface rounded-lg border py-12 shadow-xs">
        <PermissionState description="This module isn't part of your role's workspace. If you need access, ask your administrator to review your role assignment." />
      </div>
    );
  }

  const Icon = NAV_ICONS[mod.icon];
  return (
    <>
      <PageHeader
        title={mod.label}
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: mod.label }]}
      />
      <div className="border-border-strong bg-surface rounded-lg border border-dashed px-6 py-14 text-center">
        <div className="bg-brand-soft text-brand-soft-foreground mx-auto flex size-12 items-center justify-center rounded-xl">
          <Icon aria-hidden className="size-6" />
        </div>
        <p className="bg-surface-muted text-2xs text-muted mt-4 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium">
          <Construction aria-hidden className="size-3" /> Planned for Phase {mod.phase} · current build is
          Phase {CURRENT_PHASE}
        </p>
        <h2 className="mt-3 text-lg font-semibold">{mod.label} isn&apos;t available yet</h2>
        <p className="text-muted mx-auto mt-1 max-w-md text-sm">{mod.description}</p>
        <p className="text-subtle mx-auto mt-1 max-w-md text-xs">
          It will connect to the same student identity, hierarchy and permissions you&apos;re using today.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href="/dashboard">
              Back to dashboard <ArrowRight />
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/announcements">Open announcements</Link>
          </Button>
        </div>
      </div>
    </>
  );
}
