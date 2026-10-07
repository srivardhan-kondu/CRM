import { AlertTriangle, MailX, MessageSquareReply, Users } from "lucide-react";
import type { Metadata } from "next";
import { WidgetCard } from "@/components/dashboard/widgets";
import { GuardianComposer } from "@/components/communication/guardian-composer";
import { GuardianMessageList } from "@/components/communication/messages";
import { InsightCard } from "@/components/patterns/insight-card";
import { PageHeader } from "@/components/patterns/page-header";
import { PermissionState } from "@/components/patterns/states";
import { contactableStudents, sentLog } from "@/domains/messages/repository";
import { RECONTACT_AFTER_DAYS } from "@/domains/messages/templates";
import { requireAuth } from "@/lib/authz/context";
import { pluralize } from "@/lib/utils";

export const metadata: Metadata = { title: "Parent communication" };

export default async function ParentCommunicationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const authed = await requireAuth();
  const { student } = await searchParams;
  const header = (
    <PageHeader
      title="Parent communication"
      description="Personal messages to guardians, each with their own child's figures — delivered in the app and by email, with read and acknowledgement tracking."
    />
  );
  const students = await contactableStudents(authed);
  if (!students)
    return (
      <>
        {header}
        <PermissionState description="Class incharges, HODs and the principal message guardians. Ask them to contact a family." />
      </>
    );
  const sent = await sentLog(authed);
  const suggested = students.filter((s) => s.followUp);
  const critical = suggested.filter((s) => s.followUp?.severity === "critical").length;
  const noEmail = students.filter((s) => !s.guardianEmail).length;
  const replies = sent.filter((m) => m.reply).length;
  const initialIds = typeof student === "string" && students.some((s) => s.id === student) ? [student] : [];

  return (
    <>
      {header}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <InsightCard
          label="Guardians to inform"
          value={suggested.length}
          context={critical ? `${critical} below the condonation band` : "below the attendance requirement"}
          definition={`Students below their programme's attendance requirement whose guardians haven't been told in the last ${RECONTACT_AFTER_DAYS} days.`}
          tone={critical ? "danger" : suggested.length ? "warning" : "success"}
          icon={AlertTriangle}
        />
        <InsightCard
          label="Replies from guardians"
          value={replies}
          context={`across ${pluralize(sent.length, "recent message")}`}
          definition="Guardians may acknowledge a message and reply once; replies also reach the sender's notifications."
          icon={MessageSquareReply}
        />
        <InsightCard
          label="Guardians without email"
          value={noEmail}
          context={`of ${pluralize(students.length, "student")} in your scope`}
          definition="These households receive messages in the app only (if they have an account). Update contact details on Student 360."
          tone={noEmail ? "warning" : "success"}
          icon={MailX}
        />
      </div>
      {students.length === 0 ? (
        <PermissionState
          title="No students in scope"
          description="There are no enrolled students whose guardians you may message."
        />
      ) : (
        <GuardianComposer
          students={students}
          sender={`${authed.ctx.name}, ${authed.ctx.active?.roleName ?? "Staff"}`}
          institution={authed.tree.root.name}
          initialIds={initialIds}
        />
      )}
      <div id="sent" className="mt-5 scroll-mt-20">
        <WidgetCard
          title="Sent"
          description="Messages to guardians of students in your scope, newest first"
          flush
        >
          <GuardianMessageList messages={sent} showStudent />
        </WidgetCard>
      </div>
      <p className="text-2xs text-subtle mt-3 flex items-center gap-1.5">
        <Users aria-hidden className="size-3" /> Every message is recorded in the audit log with its
        recipients.
      </p>
    </>
  );
}
