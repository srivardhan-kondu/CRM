"use client";

import { AlertTriangle, Loader2, MailX, Send, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { sendGuardianMessagesAction } from "@/app/(app)/announcements/actions";
import { attendanceTone } from "@/components/patterns/status";
import { Button } from "@/components/ui/button";
import { FormError, useResultAction } from "@/components/ui/form";
import { Input, Label, Select } from "@/components/ui/input";
import type { Contactable } from "@/domains/messages/repository";
import { render, TEMPLATE_KEYS, TEMPLATES, type TemplateKey } from "@/domains/messages/templates";
import { cn, formatDate } from "@/lib/utils";
import { textareaClass } from "./controls";

const TONE = {
  success: "text-success-soft-foreground",
  warning: "text-warning-soft-foreground",
  danger: "text-danger",
} as const;

export function GuardianComposer({
  students,
  sender,
  institution,
  initialIds,
}: {
  students: Contactable[];
  sender: string;
  institution: string;
  initialIds: string[];
}) {
  const sections = useMemo(() => [...new Set(students.map((s) => s.sectionLabel))].sort(), [students]);
  const suggested = students.filter((s) => s.followUp);
  const [section, setSection] = useState(
    initialIds.length > 0
      ? (students.find((s) => s.id === initialIds[0])?.sectionLabel ?? "")
      : sections.length === 1
        ? sections[0]!
        : "",
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialIds));
  const firstTemplate: TemplateKey =
    students.find((s) => initialIds.includes(s.id))?.followUp?.template ??
    (initialIds.length ? "meeting" : "attendance_shortage");
  const [template, setTemplate] = useState<TemplateKey>(firstTemplate);
  const [subject, setSubject] = useState(TEMPLATES[firstTemplate].subject);
  const [body, setBody] = useState(TEMPLATES[firstTemplate].body);
  const [state, action, pending] = useResultAction(sendGuardianMessagesAction, () => setSelected(new Set()));

  const shown = students.filter((s) => !section || s.sectionLabel === section);
  const chosen = students.filter((s) => selected.has(s.id));
  const preview = chosen[0];
  const fields = preview && {
    student: preview.name,
    roll: preview.studentNumber,
    section: preview.sectionLabel,
    attendance: preview.attendancePct.toFixed(1),
    threshold: String(preview.attendanceThreshold),
    guardian: preview.guardianName ?? "Parent/Guardian",
    sender,
    institution,
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const chooseTemplate = (key: TemplateKey) => {
    setTemplate(key);
    setSubject(TEMPLATES[key].subject);
    setBody(TEMPLATES[key].body);
  };
  const selectSuggested = () => {
    const ids = suggested.filter((s) => !section || s.sectionLabel === section);
    setSelected(new Set(ids.map((s) => s.id)));
    const critical = ids.some((s) => s.followUp?.template === "exam_eligibility");
    chooseTemplate(
      critical && ids.every((s) => s.followUp?.template === "exam_eligibility")
        ? "exam_eligibility"
        : "attendance_shortage",
    );
  };

  return (
    <form action={action} className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="studentIds" value={id} />
      ))}
      <section aria-label="Students" className="border-border bg-surface rounded-lg border shadow-xs">
        <div className="border-border flex flex-wrap items-center gap-2 border-b p-3">
          <Select
            aria-label="Section"
            value={section}
            onChange={(e) => setSection(e.target.value)}
            className="w-40"
          >
            <option value="">All sections</option>
            {sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          {suggested.length > 0 && (
            <Button type="button" variant="subtle" size="sm" onClick={selectSuggested}>
              <Sparkles /> Select suggested (
              {suggested.filter((s) => !section || s.sectionLabel === section).length})
            </Button>
          )}
          <span className="text-muted ml-auto text-xs">{selected.size} selected</span>
        </div>
        <ul className="divide-border max-h-[32rem] divide-y overflow-y-auto">
          {shown.map((s) => (
            <li key={s.id}>
              <label className="hover:bg-surface-muted flex cursor-pointer items-start gap-3 px-4 py-2.5">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.has(s.id)}
                  onChange={() => toggle(s.id)}
                  aria-label={`${s.name} (${s.studentNumber})`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-subtle font-mono text-xs">{s.studentNumber}</span>
                    <span className="text-2xs text-subtle">{s.sectionLabel}</span>
                    <span
                      className={cn(
                        "tabular ml-auto text-xs font-medium",
                        TONE[attendanceTone(s.attendancePct, s.attendanceThreshold)],
                      )}
                    >
                      {s.attendancePct.toFixed(1)}%
                    </span>
                  </span>
                  {s.followUp && (
                    <span className="mt-1 flex items-start gap-1.5 text-xs">
                      <AlertTriangle
                        aria-hidden
                        className={cn(
                          "mt-0.5 size-3 shrink-0",
                          s.followUp.severity === "critical" ? "text-danger" : "text-warning",
                        )}
                      />
                      <span>Suggested: {s.followUp.reason}</span>
                    </span>
                  )}
                  <span className="text-2xs text-subtle mt-0.5 flex flex-wrap gap-x-3">
                    <span>{s.guardianName ?? "No guardian on record"}</span>
                    {!s.guardianEmail && (
                      <span className="inline-flex items-center gap-1">
                        <MailX aria-hidden className="size-3" /> in-app only
                      </span>
                    )}
                    {s.lastContactedAt && <span>Told about attendance {formatDate(s.lastContactedAt)}</span>}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-label="Message"
        className="border-border bg-surface space-y-4 rounded-lg border p-5 shadow-xs"
      >
        <div className="space-y-1.5">
          <Label htmlFor="gm-template">Template</Label>
          <Select
            id="gm-template"
            name="template"
            value={template}
            onChange={(e) => chooseTemplate(e.target.value as TemplateKey)}
          >
            {TEMPLATE_KEYS.map((k) => (
              <option key={k} value={k}>
                {TEMPLATES[k].label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gm-subject">Subject</Label>
          <Input
            id="gm-subject"
            name="subject"
            required
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gm-body">Message</Label>
          <textarea
            id="gm-body"
            name="body"
            required
            rows={9}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={textareaClass}
          />
          <p className="text-2xs text-subtle">
            Each guardian receives their own child&apos;s figures:{" "}
            {"{student} {roll} {section} {attendance} {threshold} {guardian} {sender}"}
          </p>
        </div>
        {fields && (
          <div className="bg-surface-muted rounded-md p-3 text-sm">
            <p className="text-2xs text-subtle mb-1">Preview for {preview!.name}&apos;s guardian</p>
            <p className="font-medium">{render(subject, fields)}</p>
            <p className="mt-2 whitespace-pre-line">{render(body, fields)}</p>
          </div>
        )}
        <p className="text-2xs text-subtle">
          Delivered in the app to linked guardian accounts and by email to the primary guardian. Email waits
          until 07:00 if sent after 21:00.
        </p>
        <FormError state={state} />
        <div className="flex justify-end">
          <Button type="submit" disabled={pending || selected.size === 0}>
            {pending ? <Loader2 className="animate-spin" /> : <Send />}
            Send to {selected.size} {selected.size === 1 ? "guardian" : "guardians"}
          </Button>
        </div>
      </section>
    </form>
  );
}
