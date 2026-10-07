import type { OrgNode, OrgTree } from "@/lib/authz/types";
import { sectionLabel } from "@/lib/utils";
import type { AudienceGroup, AudienceRule, Severity } from "./types";
import { includes } from "./visibility";

/*
 * Communication policy (ADR-023), pure so it is unit-tested and shared by the composer (to explain what will happen)
 * and the service (to enforce it).
 */

/** The org unit a notice is aimed at: publishing and approving are authorized there. */
export function audienceUnit(rule: AudienceRule, tree: OrgTree): OrgNode | null {
  switch (rule.kind) {
    case "institution":
    case "placement_eligible":
      return tree.root;
    case "department":
    case "year":
      return tree.byCode.get(rule.departmentCode) ?? null;
    case "section":
      return tree.byCode.get(rule.sectionId) ?? null;
  }
}

export const GROUP_LABEL: Record<AudienceGroup, string> = {
  everyone: "Students, guardians & staff",
  families: "Students & guardians",
  students: "Students",
  guardians: "Guardians",
  staff: "Staff",
};

const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

export function audienceLabel(rule: AudienceRule, tree: OrgTree): string {
  switch (rule.kind) {
    case "institution":
      return `${GROUP_LABEL[rule.audience]} · Institution-wide`;
    case "department":
      return `${tree.byCode.get(rule.departmentCode)?.name ?? rule.departmentCode} · ${GROUP_LABEL[rule.audience]}`;
    case "year":
      return `${rule.departmentCode} · ${ordinal(rule.year)} year · ${GROUP_LABEL[rule.audience]}`;
    case "section":
      return `Section ${sectionLabel(rule.sectionId)} · ${GROUP_LABEL[rule.audience]}`;
    case "placement_eligible":
      return `Placement-eligible · ${rule.departmentCodes.join(", ")} · ${ordinal(rule.year)} year`;
  }
}

/** What the author holds over the notice's target unit. */
export interface Authority {
  publish: boolean;
  approve: boolean;
  guardians: boolean;
}

export type PublishRoute = { kind: "direct" } | { kind: "approval" } | { kind: "denied"; reason: string };

/**
 * How a notice gets out (ADR-023): you may only address a target you may publish to; only those who may message
 * guardians address guardians; critical notices come from approvers (an emergency cannot wait in a queue). Approvers
 * publish directly, as does anyone writing to a single section; everything broader waits for someone else's approval.
 */
export function publishRoute(rule: AudienceRule, severity: Severity, authority: Authority): PublishRoute {
  if (!authority.publish) return { kind: "denied", reason: "You can't publish to this audience." };
  if (includes(rule, "guardians") && !authority.guardians)
    return {
      kind: "denied",
      reason: "Only class incharges, HODs and the principal address guardians.",
    };
  if (severity === "critical" && !authority.approve)
    return {
      kind: "denied",
      reason: "Critical notices are published by the HOD or principal for this audience.",
    };
  if (authority.approve || rule.kind === "section") return { kind: "direct" };
  return { kind: "approval" };
}

export const LIMITS = {
  title: 140,
  summary: 280,
  body: 8000,
  attachments: 3,
  attachmentBytes: 2 * 1024 * 1024,
  /** New files in one save: serverless hosts cap a request at ~4.5 MB (Vercel), and the form adds overhead. */
  uploadBytes: 4 * 1024 * 1024,
} as const;

/** Allowed attachment types, each with the leading bytes its content must start with. */
const SIGNATURES: Record<string, { ext: string; magic: number[] }> = {
  "application/pdf": { ext: "pdf", magic: [0x25, 0x50, 0x44, 0x46] },
  "image/png": { ext: "png", magic: [0x89, 0x50, 0x4e, 0x47] },
  "image/jpeg": { ext: "jpg", magic: [0xff, 0xd8, 0xff] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    ext: "docx",
    magic: [0x50, 0x4b, 0x03, 0x04],
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    ext: "xlsx",
    magic: [0x50, 0x4b, 0x03, 0x04],
  },
};

export const ATTACHMENT_TYPES = Object.keys(SIGNATURES);

export type AttachmentCheck = { ok: true } | { ok: false; reason: string };

/**
 * An attachment is accepted only if its declared type is allowed, its size is within the limit and its bytes really
 * are that type — a renamed executable is refused rather than served to every recipient.
 */
export function checkAttachment(name: string, contentType: string, bytes: Uint8Array): AttachmentCheck {
  const sig = SIGNATURES[contentType];
  if (!sig)
    return { ok: false, reason: `${name}: only PDF, PNG, JPEG, Word and Excel files can be attached.` };
  if (bytes.length === 0) return { ok: false, reason: `${name} is empty.` };
  if (bytes.length > LIMITS.attachmentBytes) return { ok: false, reason: `${name} is larger than 2 MB.` };
  if (!sig.magic.every((b, i) => bytes[i] === b))
    return { ok: false, reason: `${name} doesn't look like a ${sig.ext.toUpperCase()} file.` };
  return { ok: true };
}

/** A safe download name: no path separators, quotes or control characters. */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "attachment").slice(0, 120);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Reminders to recipients who haven't acknowledged go out at most once a day. */
export const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function canRemind(lastRemindedAt: string | null, now: Date): boolean {
  return !lastRemindedAt || now.getTime() - new Date(lastRemindedAt).getTime() >= REMINDER_COOLDOWN_MS;
}
