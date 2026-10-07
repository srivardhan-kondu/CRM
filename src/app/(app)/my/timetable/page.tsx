import { CalendarDays } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/os/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { weekdayOf } from "@/domains/attendance/calendar";
import { weeklyTimetable } from "@/domains/attendance/repository";
import { linkedStudents } from "@/domains/students/repository";
import { requireAuth } from "@/lib/authz/context";
import { institutionToday } from "@/lib/clock";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Timetable" };

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function TimetablePage() {
  const authed = await requireAuth();
  const me = [...(await linkedStudents(authed, "self")), ...(await linkedStudents(authed, "guardian"))][0];
  const header = (
    <PageHeader
      title="Timetable"
      description="The weekly class timetable for this term. Today is highlighted."
    />
  );
  if (!me)
    return (
      <>
        {header}
        <EmptyState
          icon={CalendarDays}
          title="No timetable"
          description="Timetables are shown for students and their guardians."
        />
      </>
    );
  const entries = (await weeklyTimetable(authed, me.student.sectionId)) ?? [];
  const today = weekdayOf(institutionToday().date);
  return (
    <div className="animate-page-in">
      {header}
      <p className="text-muted mb-4 text-sm">
        {me.student.name} · {me.student.sectionLabel}
      </p>
      {entries.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No classes scheduled"
          description="The timetable for this term isn't published yet."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {DAYS.map((day, i) => {
            const list = entries.filter((e) => e.weekday === i + 1);
            const isToday = today === i + 1;
            return (
              <section
                key={day}
                aria-label={day}
                className={cn(
                  "border-border bg-surface rounded-lg border",
                  isToday && "border-brand ring-brand/20 ring-2",
                )}
              >
                <h2 className="border-border flex items-center justify-between border-b px-4 py-2.5 text-sm font-semibold">
                  {day}
                  {isToday && <span className="text-brand text-xs font-medium">Today</span>}
                </h2>
                {list.length === 0 ? (
                  <p className="text-subtle px-4 py-4 text-sm">No classes</p>
                ) : (
                  <ol className="divide-border divide-y">
                    {list.map((e) => (
                      <li key={`${e.startsAt}-${e.courseCode}`} className="flex gap-3 px-4 py-2.5">
                        <span className="tabular text-muted w-12 shrink-0 text-xs">
                          {e.startsAt}
                          <span className="text-subtle block">{e.endsAt}</span>
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{e.courseName}</span>
                          <span className="text-subtle block truncate text-xs">
                            {e.courseCode} · {e.room}
                            {e.teachers.length > 0 && ` · ${e.teachers.join(", ")}`}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
