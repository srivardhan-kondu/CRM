/*
 * Natural-language questions CampusOS understands, without an LLM (rule-based by decision, see ADR-025). Each intent
 * maps to a permission-checked query in answer.ts, so the assistant and the command palette can never reveal more
 * than the pages they link to.
 */

export type Intent =
  | { kind: "attendance_below"; threshold: number | null }
  | { kind: "sections_below" }
  | { kind: "backlogs"; min: number }
  | { kind: "intervention" }
  | { kind: "pending_approvals" }
  | { kind: "exams_upcoming"; external: boolean }
  | { kind: "announcements_today" }
  | { kind: "classes_today" }
  | { kind: "unmarked_classes" };

const has = (q: string, ...words: (string | RegExp)[]) =>
  words.some((w) => (typeof w === "string" ? q.includes(w) : w.test(q)));

/** The first number followed by "%" (or "percent"), if any: "below 75% attendance" → 75. */
function percent(q: string): number | null {
  const m = /(\d{1,3}(?:\.\d+)?)\s*(?:%|percent)/.exec(q);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n <= 100 ? n : null;
}

export function parseIntent(input: string): Intent | null {
  const q = input.toLowerCase().replace(/\s+/g, " ").trim();
  if (q.length < 3) return null;

  if (has(q, "approval", "to approve", "awaiting my decision", "waiting for me"))
    return { kind: "pending_approvals" };

  if (has(q, "section", "class") && has(q, "below", "under", "short", "threshold") && has(q, "attendance"))
    return { kind: "sections_below" };

  if (has(q, "attendance", "shortage") && has(q, "below", "under", "less than", "short", "low", "<"))
    return { kind: "attendance_below", threshold: percent(q) };
  if (has(q, /\bshortage\b/)) return { kind: "attendance_below", threshold: null };

  if (has(q, "backlog", "arrear", "failed course", "supplementary"))
    return {
      kind: "backlogs",
      min: has(q, "multiple", "more than one", "two or more", "2+", "many") ? 2 : 1,
    };

  if (
    has(
      q,
      "intervention",
      "at risk",
      "at-risk",
      "high risk",
      "high-risk",
      "need help",
      "struggling",
      "follow up",
      "follow-up",
    )
  )
    return { kind: "intervention" };

  if (has(q, "not marked", "unmarked", "missed marking", "pending attendance", "attendance to mark"))
    return { kind: "unmarked_classes" };

  if (has(q, "exam", /\bsee\b/, "semester end", "semester-end", "hall ticket"))
    return {
      kind: "exams_upcoming",
      external: has(q, "external", "semester end", "semester-end", /\bsee\b/, "university"),
    };

  if (has(q, "announcement", "notice", "circular") && has(q, "today", "important", "summar", "latest", "new"))
    return { kind: "announcements_today" };

  if (has(q, "my classes", "classes today", "today's classes", "timetable", "schedule today", "my day"))
    return { kind: "classes_today" };

  return null;
}

/** Example questions, shown where the assistant is offered. */
export const SUGGESTED_QUESTIONS = [
  "Which students need intervention?",
  "Which sections are below attendance threshold?",
  "Students below 75% attendance",
  "Students with multiple backlogs",
  "What approvals are pending?",
  "What exams are coming up?",
  "Summarize today's important announcements",
] as const;
