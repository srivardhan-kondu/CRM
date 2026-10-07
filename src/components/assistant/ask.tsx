"use client";

import { ArrowRight, CornerDownLeft, Lightbulb, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { askAction } from "@/app/(app)/insights/actions";
import type { AssistantAnswer } from "@/domains/assistant/answer";
import { SUGGESTED_QUESTIONS } from "@/domains/assistant/intents";
import { cn } from "@/lib/utils";

const TONE = {
  critical: "text-danger",
  warning: "text-warning-soft-foreground",
  neutral: "text-muted",
} as const;

/**
 * Ask CampusOS. Rule-based: questions map to permission-checked queries, and every answer shows the records and links
 * it is based on. Nothing here can see more than the pages it links to.
 */
export function AskCampusOS({
  onNavigate,
  autoFocus,
  initialQuestion,
}: {
  onNavigate?: () => void;
  autoFocus?: boolean;
  /** Asked once on mount (from search: /insights?q=…). */
  initialQuestion?: string;
}) {
  const [question, setQuestion] = useState(initialQuestion ?? "");
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (q: string) => {
    const text = q.trim();
    if (text.length < 2) return;
    setQuestion(text);
    setError(null);
    start(async () => {
      const result = await askAction(text);
      if ("error" in result) setError(result.error);
      else setAnswer(result);
    });
  };

  const asked = useRef(false);
  useEffect(() => {
    if (initialQuestion && !asked.current) {
      asked.current = true;
      submit(initialQuestion);
    }
  }, [initialQuestion]);

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(question);
        }}
        className="border-border bg-surface focus-within:border-brand flex items-center gap-2 rounded-lg border px-3 shadow-xs transition-colors"
      >
        <Sparkles aria-hidden className="text-brand size-4 shrink-0" />
        <label htmlFor="ask-campusos" className="sr-only">
          Ask CampusOS
        </label>
        <input
          id="ask-campusos"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about students, attendance, exams, approvals…"
          maxLength={200}
          autoFocus={autoFocus}
          className="placeholder:text-subtle h-11 w-full bg-transparent text-sm outline-none"
        />
        <button
          type="submit"
          disabled={pending || question.trim().length < 2}
          className="text-muted hover:text-foreground disabled:opacity-40"
          aria-label="Ask"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <CornerDownLeft className="size-4" />}
        </button>
      </form>

      {error && (
        <p role="alert" className="bg-danger-soft text-danger-soft-foreground rounded-md px-3 py-2 text-sm">
          {error}
        </p>
      )}

      {!answer && !pending && (
        <div>
          <p className="text-muted mb-2 text-xs font-medium">Try asking</p>
          <ul className="flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <li key={q}>
                <button
                  type="button"
                  onClick={() => submit(q)}
                  className="border-border text-foreground hover:border-brand/40 hover:bg-brand-soft/40 rounded-full border px-3 py-1 text-xs transition-colors"
                >
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {answer && (
        <section aria-live="polite" aria-busy={pending} className={cn("space-y-4", pending && "opacity-60")}>
          <div>
            <p className="text-muted text-xs">You asked: “{answer.question}”</p>
            <p className="text-foreground mt-1 text-[15px] leading-relaxed">{answer.answer}</p>
          </div>

          {answer.records.length > 0 && (
            <div className="border-border rounded-lg border">
              <p className="border-border text-muted border-b px-4 py-2 text-xs font-medium">
                Supporting records{" "}
                {answer.total > answer.records.length &&
                  `· showing ${answer.records.length} of ${answer.total}`}
              </p>
              <ul className="divide-border divide-y">
                {answer.records.map((r, i) => (
                  <li key={`${r.href}-${i}`}>
                    <Link
                      href={r.href}
                      onClick={onNavigate}
                      className="hover:bg-surface-muted flex items-center gap-3 px-4 py-2.5 transition-colors"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{r.label}</span>
                        {r.sublabel && (
                          <span className="text-subtle block truncate text-xs">{r.sublabel}</span>
                        )}
                      </span>
                      {r.value && (
                        <span className={cn("shrink-0 text-xs font-medium", TONE[r.tone ?? "neutral"])}>
                          {r.value}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {answer.recommendation && (
            <div className="bg-brand-soft/50 flex items-start gap-2 rounded-lg px-4 py-3 text-sm">
              <Lightbulb aria-hidden className="text-brand mt-0.5 size-4 shrink-0" />
              <p className="flex-1">
                <span className="font-medium">Recommended: </span>
                {answer.recommendation.text}
              </p>
              {answer.recommendation.href && (
                <Link
                  href={answer.recommendation.href}
                  onClick={onNavigate}
                  className="text-brand inline-flex shrink-0 items-center gap-1 font-medium"
                >
                  Go <ArrowRight aria-hidden className="size-3.5" />
                </Link>
              )}
            </div>
          )}

          {answer.suggestions.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {answer.suggestions.map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    onClick={() => submit(q)}
                    className="border-border hover:border-brand/40 rounded-full border px-3 py-1 text-xs"
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="text-subtle flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck aria-hidden className="size-3.5" /> Limited to {answer.scope.toLowerCase()}
            </span>
            {answer.sources.map((s) => (
              <Link key={s.href} href={s.href} onClick={onNavigate} className="text-brand hover:underline">
                Source: {s.label}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
