import { ArrowRight, BookOpen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { TermTabs } from "@/components/academics/term-tabs";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/states";
import { Badge } from "@/components/ui/badge";
import { myTeaching, termContext } from "@/domains/academics/repository";
import { visibleStudents } from "@/domains/students/repository";
import { requireAuth } from "@/lib/authz/context";

export const metadata: Metadata = { title: "My Courses" };

export default async function MyCoursesPage({ searchParams }: { searchParams: Promise<{ term?: string }> }) {
  const authed = await requireAuth();
  const { term: code } = await searchParams;
  const { terms, term } = await termContext(authed, code);
  const [offerings, students] = await Promise.all([
    term ? myTeaching(authed, term.id) : Promise.resolve([]),
    visibleStudents(authed),
  ]);
  const roster = (sectionCode: string) => students.filter((v) => v.student.sectionId === sectionCode).length;
  const hours = offerings.reduce((n, o) => n + o.weeklyHours, 0);

  return (
    <>
      <PageHeader
        title="My Courses"
        description={
          offerings.length
            ? `${offerings.length} offerings · ${hours} contact hours a week · ${term?.name}`
            : "Courses you are allocated to teach."
        }
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "My Courses" }]}
      />
      <TermTabs terms={terms} active={term?.code} href={(c) => `/my/courses?term=${c}`} />
      {offerings.length === 0 ? (
        <div className="border-border bg-surface rounded-lg border shadow-xs">
          <EmptyState
            icon={BookOpen}
            title={`No allocations in ${term?.name ?? "this term"}`}
            description="Your head of department allocates courses on the Courses page. Access to a section's students follows allocation."
          />
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {offerings.map((o) => {
            const mine = o.allocations.find((a) => a.userId === authed.ctx.userId);
            const others = o.allocations.filter((a) => a.userId !== authed.ctx.userId);
            return (
              <li key={o.id}>
                <Link
                  href={`/my/courses/${o.id}${term && !term.isCurrent ? `?term=${term.code}` : ""}`}
                  className="border-border bg-surface hover:border-border-strong flex h-full flex-col rounded-lg border p-4 shadow-xs transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-subtle font-mono text-xs">{o.courseCode}</p>
                      <p className="font-medium">{o.courseName}</p>
                    </div>
                    {mine && mine.role !== "primary" && (
                      <Badge tone="info">{mine.role.replace("_", "-")}</Badge>
                    )}
                  </div>
                  <p className="text-muted mt-2 text-sm">
                    Section {o.sectionLabel} · {roster(o.sectionCode)} students
                  </p>
                  <p className="text-2xs text-subtle mt-0.5">
                    {o.credits} credits · {o.weeklyHours} h/wk
                    {others.length > 0 && ` · with ${others.map((a) => a.name).join(", ")}`}
                  </p>
                  <span className="text-brand mt-auto inline-flex items-center gap-1 pt-3 text-xs font-medium">
                    Open roster <ArrowRight aria-hidden className="size-3" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
