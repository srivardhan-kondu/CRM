"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Mail,
  Paperclip,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { saveNoticeAction } from "@/app/(app)/announcements/actions";
import { Button } from "@/components/ui/button";
import { FormError, useResultAction } from "@/components/ui/form";
import { Input, Label, Select } from "@/components/ui/input";
import type { TargetOption } from "@/domains/announcements/repository";
import type { AudienceChoice } from "@/domains/announcements/repository";
import {
  ATTACHMENT_TYPES,
  GROUP_LABEL,
  LIMITS,
  publishRoute,
  STAFF_ROLES,
} from "@/domains/announcements/rules";
import {
  AUDIENCE_GROUPS,
  CATEGORIES,
  type AnnouncementCategory,
  type AudienceGroup,
  type AudienceRule,
  type Severity,
} from "@/domains/announcements/types";
import { includes } from "@/domains/announcements/visibility";
import { cn, formatNumber } from "@/lib/utils";
import { CATEGORY_LABEL } from "./labels";
import { textareaClass } from "./controls";

export interface ComposerInitial {
  id: string;
  title: string;
  summary: string;
  body: string;
  category: AnnouncementCategory;
  severity: Severity;
  target: string;
  audience: AudienceChoice;
  publishAt: string;
  deadline: string;
  expiresAt: string;
  requiresAck: boolean;
  sendEmail: boolean;
  attachments: { id: string; name: string; size: string }[];
  returnedNote: string | null;
}

/** A rule with the same target and audience as the form, for the policy preview (labels don't matter here). */
function previewRule(target: string, choice: AudienceChoice): AudienceRule {
  if (choice.startsWith("role:")) return { kind: "role", roleKey: choice.slice(5), unitCode: target };
  const audience = choice as AudienceGroup;
  return target.startsWith("section:")
    ? { kind: "section", sectionId: target.slice(8), audience }
    : { kind: "institution", audience };
}

export function Composer({
  targets,
  initial,
  minDate,
}: {
  targets: TargetOption[];
  initial: ComposerInitial | null;
  minDate: string;
}) {
  const router = useRouter();
  const [state, action, pending] = useResultAction(saveNoticeAction, () =>
    router.push("/announcements/sent"),
  );
  const [target, setTarget] = useState(initial?.target ?? targets[0]!.key);
  const [audience, setAudience] = useState<AudienceChoice>(initial?.audience ?? "students");
  const [role, setRole] = useState<string>(
    initial?.audience.startsWith("role:") ? initial.audience.slice(5) : STAFF_ROLES[0].key,
  );
  const [severity, setSeverity] = useState<Severity>(initial?.severity ?? "normal");
  const [sendEmail, setSendEmail] = useState(initial?.sendEmail ?? false);
  const option = targets.find((t) => t.key === target) ?? targets[0]!;
  const rule = previewRule(option.key, audience);
  const route = publishRoute(rule, severity, option.authority, option.key.startsWith("section:"));
  const emailable = includes(rule, "students") || includes(rule, "guardians");

  const groups = useMemo(() => {
    const map = new Map<string, TargetOption[]>();
    for (const t of targets) map.set(t.group, [...(map.get(t.group) ?? []), t]);
    return [...map.entries()];
  }, [targets]);

  const reach = [
    includes(rule, "students") ? `${formatNumber(option.students)} students` : null,
    includes(rule, "guardians") ? `${formatNumber(option.guardians)} guardian households` : null,
    rule.kind === "role"
      ? `${STAFF_ROLES.find((r) => r.key === rule.roleKey)?.label.toLowerCase() ?? "staff"} in this scope`
      : includes(rule, "staff")
        ? "staff in this scope"
        : null,
  ].filter(Boolean);
  const missingEmails = includes(rule, "guardians") ? option.guardians - option.guardianEmails : 0;

  return (
    <form action={action} className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div className="border-border bg-surface space-y-4 rounded-lg border p-5 shadow-xs">
        {initial?.returnedNote && (
          <p className="bg-danger-soft text-danger-soft-foreground rounded-md px-3 py-2 text-sm">
            Returned by the approver: “{initial.returnedNote}”
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="n-title">Title</Label>
          <Input
            id="n-title"
            name="title"
            required
            minLength={5}
            maxLength={LIMITS.title}
            defaultValue={initial?.title}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="n-summary">Summary</Label>
          <Input
            id="n-summary"
            name="summary"
            required
            minLength={10}
            maxLength={LIMITS.summary}
            defaultValue={initial?.summary}
            placeholder="One line people read in the list and in the email"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="n-body">Details</Label>
          <textarea
            id="n-body"
            name="body"
            rows={8}
            maxLength={LIMITS.body}
            defaultValue={initial?.body}
            className={textareaClass}
            placeholder="Leave a blank line between paragraphs."
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="n-category">Category</Label>
            <Select id="n-category" name="category" defaultValue={initial?.category ?? "academic"}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="n-severity">Priority</Label>
            <Select
              id="n-severity"
              name="severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Severity)}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical" disabled={!option.authority.approve}>
                Critical{option.authority.approve ? "" : " (approvers only)"}
              </option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="n-deadline">Action deadline (optional)</Label>
            <Input
              id="n-deadline"
              name="deadline"
              type="datetime-local"
              min={minDate}
              defaultValue={initial?.deadline}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="n-publish">Publish at (optional — leave empty to publish now)</Label>
            <Input
              id="n-publish"
              name="publishAt"
              type="datetime-local"
              min={minDate}
              defaultValue={initial?.publishAt}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="n-expires">Active until (optional)</Label>
            <Input
              id="n-expires"
              name="expiresAt"
              type="datetime-local"
              min={minDate}
              defaultValue={initial?.expiresAt}
            />
          </div>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-foreground mb-1 text-xs font-medium">
            Attachments (PDF, image, Word or Excel; up to 3 files, 2 MB each, 4 MB per save)
          </legend>
          {initial?.attachments.map((f) => (
            <label key={f.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="removeAttachments" value={f.id} />
              <Paperclip aria-hidden className="text-subtle size-3.5" /> Remove {f.name}
              <span className="text-subtle text-xs">{f.size}</span>
            </label>
          ))}
          <input
            type="file"
            name="attachments"
            multiple
            accept={ATTACHMENT_TYPES.join(",")}
            aria-label="Attach files"
            className="text-muted file:border-border file:bg-surface block text-sm file:mr-3 file:rounded-md file:border file:px-3 file:py-1.5 file:text-sm"
          />
        </fieldset>
      </div>

      <aside className="space-y-4">
        <div className="border-border bg-surface space-y-4 rounded-lg border p-5 shadow-xs">
          <div className="space-y-1.5">
            <Label htmlFor="n-target">Send to</Label>
            <Select id="n-target" name="target" value={target} onChange={(e) => setTarget(e.target.value)}>
              {groups.map(([group, options]) => (
                <optgroup key={group} label={group}>
                  {options.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-foreground mb-1 text-xs font-medium">Who in it</legend>
            {AUDIENCE_GROUPS.map((g) => {
              const disabled =
                includes({ kind: "institution", audience: g }, "guardians") && !option.authority.guardians;
              return (
                <label key={g} className={cn("flex items-center gap-2 text-sm", disabled && "text-subtle")}>
                  <input
                    type="radio"
                    name="audience"
                    value={g}
                    checked={audience === g}
                    disabled={disabled}
                    onChange={() => setAudience(g)}
                  />
                  {GROUP_LABEL[g]}
                </label>
              );
            })}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="audience"
                value={`role:${role}`}
                checked={audience.startsWith("role:")}
                onChange={() => setAudience(`role:${role}`)}
              />
              Staff with the role
              <Select
                aria-label="Staff role"
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                  if (audience.startsWith("role:")) setAudience(`role:${e.target.value}`);
                }}
                className="h-7 w-auto py-0 text-xs"
              >
                {STAFF_ROLES.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </label>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="requiresAck" defaultChecked={initial?.requiresAck} /> Ask recipients
            to acknowledge
          </label>
          <label className={cn("flex items-center gap-2 text-sm", !emailable && "text-subtle")}>
            <input
              type="checkbox"
              name="sendEmail"
              checked={sendEmail && emailable}
              disabled={!emailable}
              onChange={(e) => setSendEmail(e.target.checked)}
            />
            Also send by email
          </label>
        </div>

        <div
          className="border-border bg-surface-muted space-y-2 rounded-lg border p-4 text-sm"
          aria-live="polite"
        >
          <p className="flex items-start gap-2">
            <Users aria-hidden className="text-subtle mt-0.5 size-4 shrink-0" />
            <span>Reaches {reach.length ? reach.join(", ") : "nobody yet"}.</span>
          </p>
          {sendEmail && emailable && (
            <p className="flex items-start gap-2">
              <Mail aria-hidden className="text-subtle mt-0.5 size-4 shrink-0" />
              <span>
                Email is held between 21:00 and 07:00 unless critical
                {missingEmails > 0
                  ? `; ${formatNumber(missingEmails)} households have no email and see it in the app only`
                  : ""}
                .
              </span>
            </p>
          )}
          {route.kind === "denied" ? (
            <p className="text-danger flex items-start gap-2">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" /> {route.reason}
            </p>
          ) : route.kind === "approval" ? (
            <p className="flex items-start gap-2">
              <ShieldCheck aria-hidden className="text-warning mt-0.5 size-4 shrink-0" />
              Goes to an approver for this audience (HOD or principal) before anyone sees it.
            </p>
          ) : (
            <p className="flex items-start gap-2">
              <CheckCircle2 aria-hidden className="text-success mt-0.5 size-4 shrink-0" /> Publishes
              immediately.
            </p>
          )}
        </div>

        <FormError state={state} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="submit" name="intent" value="draft" variant="secondary" disabled={pending}>
            Save draft
          </Button>
          <Button type="submit" name="intent" value="send" disabled={pending || route.kind === "denied"}>
            {pending ? <Loader2 className="animate-spin" /> : <Send />}
            {route.kind === "approval" ? "Submit for approval" : "Publish"}
          </Button>
        </div>
      </aside>
    </form>
  );
}
