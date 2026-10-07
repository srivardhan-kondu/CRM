import type { Metadata } from "next";
import { AskCampusOS } from "@/components/assistant/ask";
import { PageHeader } from "@/components/patterns/page-header";
import { requireAuth } from "@/lib/authz/context";

export const metadata: Metadata = { title: "Ask a question" };

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAuth();
  const { q } = await searchParams;
  const initial = typeof q === "string" ? q.slice(0, 200) : undefined;
  return (
    <div className="animate-page-in mx-auto max-w-3xl">
      <PageHeader
        title="Ask a question"
        description="Ask about students, attendance, results, exams, approvals and notices. Every answer comes from the same permission-checked records as the pages it links to — nothing outside your access."
      />
      <div className="border-border bg-surface rounded-lg border p-5">
        <AskCampusOS autoFocus={!initial} initialQuestion={initial} />
      </div>
      <p className="text-subtle mt-3 text-xs">
        Answers are computed from records, not generated text. A language model can be added later behind the
        same permission checks.
      </p>
    </div>
  );
}
