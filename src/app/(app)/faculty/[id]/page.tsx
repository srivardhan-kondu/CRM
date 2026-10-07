import { Mail } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadTone, TermTabs } from "@/components/academics/term-tabs";
import { WidgetCard } from "@/components/dashboard/widgets";
import { PageHeader } from "@/components/patterns/page-header";
import { Avatar, Meter } from "@/components/ui/misc";
import { listFaculty, termContext } from "@/domains/academics/repository";
import { requireAuth } from "@/lib/authz/context";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Faculty profile" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ term?: string }> };

export default async function FacultyProfilePage({ params, searchParams }: Props) {
  const authed = await requireAuth();
  const { id } = await params;
  const { term: code } = await searchParams;
  const { terms, term } = await termContext(authed, code);
  // Same visibility as the list: out-of-scope and unknown profiles are both 404.
  const f = (await listFaculty(authed, term?.id ?? null))?.find((x) => x.userId === id);
  if (!f) notFound();

  return (
    <>
      <PageHeader
        title={f.name}
        description={`${f.designation} · ${f.departmentName}`}
        breadcrumbs={[{ label: "Faculty", href: "/faculty" }, { label: f.name }]}
      />
      <section className="border-border bg-surface mb-5 flex flex-col gap-4 rounded-lg border p-5 shadow-xs sm:flex-row sm:items-center">
        <Avatar name={f.name} size="xl" />
        <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
          <div>
            <dt className="text-2xs text-muted">Employee code</dt>
            <dd className="font-mono">{f.employeeCode}</dd>
          </div>
          <div>
            <dt className="text-2xs text-muted">Joined</dt>
            <dd>{f.joinedOn ? formatDate(f.joinedOn) : "—"}</dd>
          </div>
          <div>
            <dt className="text-2xs text-muted">Status</dt>
            <dd className="capitalize">{f.status.replace("_", " ")}</dd>
          </div>
          <div>
            <dt className="text-2xs text-muted">Email</dt>
            <dd className="flex items-center gap-1 truncate">
              <Mail aria-hidden className="text-subtle size-3.5" /> {f.email}
            </dd>
          </div>
        </dl>
      </section>
      <TermTabs terms={terms} active={term?.code} href={(c) => `/faculty/${f.userId}?term=${c}`} />
      <WidgetCard
        title="Teaching"
        description={`${f.hours} of ${f.maxWeeklyHours} contact hours a week · ${term?.name ?? "no term"}`}
        action={
          <Meter
            value={(f.hours / f.maxWeeklyHours) * 100}
            tone={loadTone(f.hours, f.maxWeeklyHours)}
            label="Teaching load"
            className="w-32"
          />
        }
        flush
      >
        {f.teaching.length === 0 ? (
          <p className="text-muted px-4 py-8 text-center text-sm">No allocations in this term.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border text-2xs text-subtle border-b text-left tracking-wide uppercase">
                <th className="px-4 py-2 font-medium">Course</th>
                <th className="px-3 py-2 font-medium">Section</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-4 py-2 text-right font-medium">h/wk</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {f.teaching.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-2">
                    <div className="font-medium">{t.courseName}</div>
                    <div className="text-2xs text-subtle font-mono">{t.courseCode}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/courses${term && !term.isCurrent ? `?term=${term.code}` : ""}`}
                      className="hover:text-brand"
                    >
                      {t.sectionLabel}
                    </Link>
                  </td>
                  <td className="text-muted px-3 py-2 text-xs capitalize">{t.role.replace("_", "-")}</td>
                  <td className="tabular px-4 py-2 text-right">{t.weeklyHours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </WidgetCard>
    </>
  );
}
