import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WidgetCard } from "@/components/dashboard/widgets";
import { EntrySheet } from "@/components/exams/entry-sheet";
import { PageHeader } from "@/components/patterns/page-header";
import { saveSeeMarksAction } from "@/app/(app)/exams/actions";
import { examMarkSheet } from "@/domains/exams/repository";
import { requireAuth } from "@/lib/authz/context";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Semester-end marks" };

export default async function ExamMarksPage({
  params,
}: {
  params: Promise<{ eventId: string; courseId: string }>;
}) {
  const authed = await requireAuth();
  const { eventId, courseId } = await params;
  const m = await examMarkSheet(authed, eventId, courseId);
  if (!m) notFound();
  const editable = m.canManage && m.held && m.event.status !== "published";
  const note =
    m.event.status === "published"
      ? "Results are published; marks change only through revaluation."
      : !m.held
        ? `This paper is examined on ${formatDate(m.course.date)}; marks are entered after it.`
        : "Enter each candidate's marks, or mark them absent.";

  return (
    <>
      <PageHeader
        title={`${m.course.courseCode} · ${m.course.courseName}`}
        description={`${m.event.name} · ${formatDate(m.course.date)} ${m.course.session}`}
        breadcrumbs={[
          { label: "Examinations", href: "/exams" },
          { label: m.event.code, href: `/exams/${m.event.id}` },
          { label: m.course.courseCode },
        ]}
      />
      <WidgetCard title="Semester-end marks" description={note}>
        <EntrySheet
          readonly={!editable}
          action={saveSeeMarksAction}
          hidden={{ eventId: m.event.id, courseId: m.course.courseId }}
          label="Save marks"
          rows={m.rows.map((r) => ({
            id: r.id,
            studentNumber: r.studentNumber,
            name: r.studentName,
            max: r.seeMax,
            marks: r.seeMarks,
            absent: r.seeAbsent,
            locked: r.maySit ? undefined : "Not eligible to sit (attendance)",
            aside: r.cieCarried !== null ? `internal ${r.cieCarried} carried` : undefined,
          }))}
        />
      </WidgetCard>
    </>
  );
}
