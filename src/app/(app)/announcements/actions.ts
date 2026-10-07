"use server";

import { revalidatePath } from "next/cache";
import {
  acknowledgeNotice,
  decideNotice,
  deleteDraft,
  recallNotice,
  remindPending,
  saveNotice,
  toggleSaved,
  withdrawNotice,
  type NewAttachment,
} from "@/domains/announcements/service";
import { acknowledgeMessage, sendGuardianMessages } from "@/domains/messages/service";
import { dispatchNow, markNotificationsRead } from "@/domains/notifications/repository";
import type { ActionResult } from "@/lib/audit/result";
import { currentAuth } from "@/lib/authz/context";

/*
 * Communication Hub endpoints. Each re-authenticates and delegates to the domain service, which authorizes, validates,
 * writes the change with its audit event in one transaction, and explains the outcome.
 */

type Result = ActionResult | { ok: true; message: string } | { ok: false; error: string };
type Authed = NonNullable<Awaited<ReturnType<typeof currentAuth>>>;

async function run(fn: (a: Authed) => Promise<Result>): Promise<Result> {
  const authed = await currentAuth();
  if (!authed) return { ok: false, error: "Your session has ended. Sign in again." };
  const result = await fn(authed);
  // Notices feed the bell, the sidebar badge and every dashboard: refresh the whole shell.
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

const field = (form: FormData, name: string) => form.get(name) ?? undefined;

async function filesOf(form: FormData): Promise<NewAttachment[]> {
  const files = form.getAll("attachments").filter((f): f is File => f instanceof File && f.size > 0);
  return Promise.all(
    files.map(async (f) => ({ name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })),
  );
}

export async function saveNoticeAction(_prev: unknown, form: FormData) {
  const files = await filesOf(form);
  return run((a) =>
    saveNotice(
      a,
      {
        id: field(form, "id"),
        intent: field(form, "intent"),
        title: field(form, "title"),
        summary: field(form, "summary"),
        body: field(form, "body"),
        category: field(form, "category"),
        severity: field(form, "severity"),
        target: field(form, "target"),
        audience: field(form, "audience"),
        deadline: field(form, "deadline"),
        expiresAt: field(form, "expiresAt"),
        publishAt: field(form, "publishAt"),
        requiresAck: form.get("requiresAck") === "on",
        sendEmail: form.get("sendEmail") === "on",
        removeAttachments: form.getAll("removeAttachments").map(String),
      },
      files,
    ),
  );
}

export async function decideNoticeAction(_prev: unknown, form: FormData) {
  return run((a) =>
    decideNotice(a, {
      id: field(form, "id"),
      decision: field(form, "decision"),
      note: field(form, "note") || undefined,
    }),
  );
}

export async function recallNoticeAction(_prev: unknown, form: FormData) {
  return run((a) => recallNotice(a, { id: field(form, "id") }));
}

export async function deleteDraftAction(_prev: unknown, form: FormData) {
  return run((a) => deleteDraft(a, { id: field(form, "id") }));
}

export async function withdrawNoticeAction(_prev: unknown, form: FormData) {
  return run((a) => withdrawNotice(a, { id: field(form, "id"), reason: field(form, "reason") }));
}

export async function acknowledgeNoticeAction(_prev: unknown, form: FormData) {
  return run((a) => acknowledgeNotice(a, { id: field(form, "id") }));
}

export async function toggleSavedAction(_prev: unknown, form: FormData) {
  return run((a) => toggleSaved(a, { id: field(form, "id") }));
}

export async function remindAction(_prev: unknown, form: FormData) {
  return run((a) => remindPending(a, { id: field(form, "id") }));
}

export async function sendGuardianMessagesAction(_prev: unknown, form: FormData) {
  return run((a) =>
    sendGuardianMessages(a, {
      studentIds: form.getAll("studentIds").map(String),
      template: field(form, "template"),
      subject: field(form, "subject"),
      body: field(form, "body"),
    }),
  );
}

export async function acknowledgeMessageAction(_prev: unknown, form: FormData) {
  return run((a) => acknowledgeMessage(a, { id: field(form, "id"), reply: field(form, "reply") }));
}

export async function dispatchNowAction() {
  return run((a) => dispatchNow(a));
}

/** Marks the bell's notifications read (no result toast: the bell simply clears). */
export async function markNotificationsReadAction() {
  const authed = await currentAuth();
  if (!authed) return;
  await markNotificationsRead(authed);
  revalidatePath("/", "layout");
}
