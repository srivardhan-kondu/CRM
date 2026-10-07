import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Composer, type ComposerInitial } from "@/components/communication/composer";
import { PageHeader } from "@/components/patterns/page-header";
import { PermissionState } from "@/components/patterns/states";
import {
  audienceChoice,
  composerTargets,
  managedNotice,
  targetKey,
} from "@/domains/announcements/repository";
import { formatBytes } from "@/domains/announcements/rules";
import { requireAuth } from "@/lib/authz/context";
import { institutionNow } from "@/lib/clock";

export const metadata: Metadata = { title: "New announcement" };

/** "2026-10-12T17:00" in institution time, for datetime-local inputs. */
function localInput(iso: string | null): string {
  if (!iso) return "";
  return new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 16);
}

export default async function NewAnnouncementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const authed = await requireAuth();
  const { draft } = await searchParams;
  const targets = await composerTargets(authed);
  const header = (
    <PageHeader
      title={draft ? "Edit announcement" : "New announcement"}
      breadcrumbs={[{ label: "Announcements", href: "/announcements" }, { label: draft ? "Edit" : "New" }]}
      description="Notices go to everyone in the audience you choose, in the app and optionally by email. Broad notices from non-approvers are checked by an approver first."
    />
  );
  if (targets.length === 0)
    return (
      <>
        {header}
        <PermissionState description="Your role doesn't publish announcements. Ask your class incharge or HOD to send one." />
      </>
    );

  let initial: ComposerInitial | null = null;
  if (typeof draft === "string") {
    const a = await managedNotice(authed, draft);
    if (!a || a.authorId !== authed.ctx.userId || (a.status !== "draft" && a.status !== "rejected"))
      notFound();
    initial = {
      id: a.id,
      title: a.title,
      summary: a.summary,
      body: a.body.join("\n\n"),
      category: a.category,
      severity: a.severity,
      target: targetKey(a.audience, authed.tree),
      audience: audienceChoice(a.audience),
      deadline: localInput(a.deadline),
      expiresAt: localInput(a.expiresAt),
      publishAt: localInput(a.scheduledFor),
      requiresAck: a.requiresAck,
      sendEmail: a.sendEmail,
      attachments: a.attachments.map((f) => ({ id: f.id, name: f.name, size: formatBytes(f.sizeBytes) })),
      returnedNote: a.status === "rejected" ? a.decisionNote : null,
    };
  }

  return (
    <>
      {header}
      <Composer targets={targets} initial={initial} minDate={localInput(institutionNow().toISOString())} />
    </>
  );
}
