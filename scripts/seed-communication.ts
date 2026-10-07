import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as s from "../src/db/schema";
import { loadRecipientStudents } from "../src/domains/announcements/load";
import { audienceLabel, audienceUnit } from "../src/domains/announcements/rules";
import { includes, targetsStudent } from "../src/domains/announcements/visibility";
import { render, TEMPLATES } from "../src/domains/messages/templates";
import { outboxRows } from "../src/domains/notifications/outbox";
import { buildOrgTree } from "../src/lib/authz/org-tree";
import type { OrgNode } from "../src/lib/authz/types";
import { ANNOUNCEMENTS } from "../src/lib/demo/announcements";
import { guardianEmailFor, seedGuardianMessages, syntheticReceipt } from "../src/lib/demo/communication";
import { STUDENTS } from "../src/lib/demo/fixtures";
import { syntheticPdf } from "../src/lib/demo/pdf";
import { SEED_USERS } from "../src/lib/demo/personas";

/*
 * Phase 5 seed: guardian email addresses (backfilled where missing), the notices of lib/demo/announcements.ts with
 * their recipients and synthetic reading behaviour, the emails those notices sent, and Ms. Kavya Nair's guardian
 * messages. Notices and messages are written once — if the tenant has any notice, they are left unchanged.
 */

type Db = NeonHttpDatabase<typeof s>;

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

const HOUR = 60 * 60 * 1000;

export async function seedCommunication(
  db: Db,
  tenantId: string,
  personaIds: ReadonlyMap<string, string>,
  log: (m: string) => void,
) {
  // Guardian emails: synthetic addresses for primary guardians that have none (edits made in the app are kept).
  const emails = STUDENTS.map((st) => [st.id, guardianEmailFor(st.studentNumber)] as const).filter(
    (e): e is readonly [string, string] => e[1] !== null,
  );
  for (const part of chunks([...emails], 250)) {
    await db.execute(sql`
      update guardian set email = v.email
      from (values ${sql.join(
        part.map(([id, email]) => sql`(${id}::uuid, ${email})`),
        sql`, `,
      )}) as v(student_id, email)
      where guardian.student_id = v.student_id and guardian.is_primary and guardian.email is null
        and guardian.tenant_id = ${tenantId}::uuid`);
  }

  const [existing] = await db
    .select({ id: s.announcement.id })
    .from(s.announcement)
    .where(eq(s.announcement.tenantId, tenantId))
    .limit(1);
  if (existing) {
    log("communication: notices already present, left unchanged");
    return;
  }

  const units = await db
    .select({
      id: s.orgUnit.id,
      parentId: s.orgUnit.parentId,
      type: s.orgUnit.type,
      code: s.orgUnit.code,
      name: s.orgUnit.name,
      path: s.orgUnit.path,
      depth: s.orgUnit.depth,
    })
    .from(s.orgUnit)
    .where(eq(s.orgUnit.tenantId, tenantId));
  const tree = buildOrgTree(tenantId, units as OrgNode[]);
  const students = await loadRecipientStudents(db, tenantId);
  const personaStudents = new Set(
    SEED_USERS.flatMap((u) => u.links ?? []).map(
      (l) => STUDENTS.find((st) => st.studentNumber === l.studentNumber)?.id,
    ),
  );
  const persona = (key: string | null) => (key ? (personaIds.get(key) ?? null) : null);

  let receiptCount = 0;
  let outboxCount = 0;
  for (const a of ANNOUNCEMENTS) {
    const unit = audienceUnit(a.audience, tree);
    if (!unit) throw new Error(`Seed: no unit for ${a.id}`);
    const id = crypto.randomUUID();
    const at = new Date(a.publishedAt);
    const body = a.body.join("\n\n");
    await db.insert(s.announcement).values({
      id,
      tenantId,
      seedKey: a.id,
      title: a.title,
      summary: a.summary,
      body,
      category: a.category,
      severity: a.severity,
      audience: a.audience,
      audienceLabel: audienceLabel(a.audience, tree),
      audienceUnitId: unit.id,
      requiresAck: a.requiresAck,
      sendEmail: a.sendEmail,
      deadline: a.deadline ? new Date(a.deadline) : null,
      expiresAt: a.expiresAt ? new Date(a.expiresAt) : null,
      ctaLabel: a.cta?.label ?? null,
      ctaPhase: a.cta?.phase ?? null,
      status: "draft",
      authorId: persona(a.authorKey),
      authorName: a.author,
      authorRole: a.authorRole,
      createdAt: new Date(at.getTime() - HOUR / 2),
      updatedAt: at,
    });
    // Attachments are added while the notice is a draft (the database freezes them afterwards).
    for (const f of a.attachments) {
      const bytes = syntheticPdf(f.name.replace(/\.\w+$/, "").replace(/-/g, " "), [a.title, a.summary]);
      await db.insert(s.announcementAttachment).values({
        tenantId,
        announcementId: id,
        fileName: f.name.replace(/\.\w+$/, ".pdf"),
        contentType: "application/pdf",
        sizeBytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        contentBase64: Buffer.from(bytes).toString("base64"),
        uploadedBy: persona(a.authorKey),
        uploadedAt: at,
      });
    }
    if (a.status === "draft") continue;
    await db
      .update(s.announcement)
      .set(
        a.status === "pending"
          ? { status: "pending", submittedAt: at }
          : { status: a.status, submittedAt: at, publishedAt: at },
      )
      .where(eq(s.announcement.id, id));
    if (a.status !== "published") continue;

    // Recipients at publication, with synthetic reading behaviour.
    const targeted = students.filter((st) => targetsStudent(a.audience, st));
    const keyed = [
      ...(includes(a.audience, "students")
        ? targeted.map((st) => ({ key: `s:${st.id}`, kind: "student" as const, st }))
        : []),
      ...(includes(a.audience, "guardians")
        ? targeted
            .filter((st) => st.guardianName)
            .map((st) => ({ key: `g:${st.id}`, kind: "guardian" as const, st }))
        : []),
    ];
    const receipts = keyed.map(({ key, kind, st }) => ({
      tenantId,
      announcementId: id,
      recipientKey: key,
      kind,
      studentId: st.id,
      deliveredAt: at,
      ...syntheticReceipt(a.id, key, a.publishedAt, a.requiresAck, personaStudents.has(st.id)),
    }));
    for (const part of chunks(receipts, 1000)) await db.insert(s.announcementReceipt).values(part);
    receiptCount += receipts.length;

    if (a.sendEmail) {
      const link = `/announcements?view=mine&id=${id}`;
      const rows = outboxRows(
        tenantId,
        { type: "announcement", id },
        keyed.map(({ kind, st }) => ({
          recipientKind: kind,
          studentId: st.id,
          toName: kind === "student" ? st.name : st.guardianName!,
          toAddress: kind === "student" ? st.email : st.guardianEmail,
          subject: a.title,
          body: `${a.summary}\n\nRead the full notice from ${a.author}: ${link}`,
        })),
        at,
        a.severity === "critical",
      ).map((r) =>
        r.status === "suppressed"
          ? r
          : { ...r, status: "sent" as const, sentAt: r.notBefore as Date, attempts: 1, transport: "log" },
      );
      for (const part of chunks(rows, 500)) await db.insert(s.notificationOutbox).values(part);
      outboxCount += rows.length;
    }
  }

  // Guardian messages from the class incharge of 3-CSE-A and the HOD.
  const parent = personaIds.get("parent")!;
  const byNumber = new Map(students.map((st) => [st.studentNumber, st]));
  const fixtureByNumber = new Map(STUDENTS.map((st) => [st.studentNumber, st]));
  const batches = new Map<string, string>();
  const messages = seedGuardianMessages();
  for (const m of messages) {
    const st = byNumber.get(m.studentNumber)!;
    const fx = fixtureByNumber.get(m.studentNumber)!;
    const template = TEMPLATES[m.template];
    const fields = {
      student: st.name,
      roll: st.studentNumber,
      section: fx.sectionLabel,
      attendance: fx.attendancePct.toFixed(1),
      threshold: String(fx.attendanceThreshold),
      guardian: st.guardianName ?? "Parent/Guardian",
      sender: `${m.senderName}, ${m.senderRole}`,
      institution: tree.root.name,
    };
    const batchKey = `${m.senderKey}:${m.template}:${m.sentAt}`;
    if (!batches.has(batchKey)) batches.set(batchKey, crypto.randomUUID());
    const id = crypto.randomUUID();
    const sender = personaIds.get(m.senderKey)!;
    const sentAt = new Date(m.sentAt);
    const acknowledgedAt = m.acknowledgedAt ? new Date(m.acknowledgedAt) : null;
    const guardianUser =
      m.studentNumber === SEED_USERS.find((u) => u.key === "parent")!.links![0]!.studentNumber
        ? parent
        : null;
    await db.insert(s.guardianMessage).values({
      id,
      tenantId,
      studentId: st.id,
      batchId: batches.get(batchKey)!,
      template: m.template,
      subject: render(template.subject, fields),
      body: render(template.body, fields),
      senderId: sender,
      senderName: m.senderName,
      senderRole: m.senderRole,
      sentAt,
      readAt: m.read
        ? new Date(Math.min(sentAt.getTime() + 3 * HOUR, (acknowledgedAt ?? sentAt).getTime() + HOUR))
        : null,
      acknowledgedAt,
      // Seeded households without an account acknowledged through the emailed link; the column records who did.
      acknowledgedBy: acknowledgedAt ? (guardianUser ?? sender) : null,
      reply: m.reply,
    });
    const [row] = outboxRows(
      tenantId,
      { type: "guardian_message", id },
      [
        {
          recipientKind: "guardian",
          studentId: st.id,
          toName: st.guardianName ?? "Parent/Guardian",
          toAddress: st.guardianEmail,
          subject: render(template.subject, fields),
          body: render(template.body, fields),
        },
      ],
      sentAt,
      false,
    );
    // Older messages have gone; last night's waits in the outbox until the dispatcher runs.
    const delivered =
      row!.status !== "suppressed" &&
      row!.notBefore.getTime() + 24 * HOUR < Date.parse("2026-10-06T00:00:00+05:30");
    await db
      .insert(s.notificationOutbox)
      .values(
        delivered
          ? { ...row!, status: "sent", sentAt: row!.notBefore as Date, attempts: 1, transport: "log" }
          : row!,
      );
    if (m.reply)
      await db.insert(s.userNotification).values({
        tenantId,
        userId: sender,
        kind: "guardian_message.reply",
        title: `Reply from the guardian of ${st.name}`,
        body: `“${m.reply}”`,
        href: "/parent-communication#sent",
        createdAt: acknowledgedAt!,
        readAt: acknowledgedAt!.getTime() < Date.parse("2026-10-04T00:00:00+05:30") ? acknowledgedAt : null,
      });
    if (guardianUser)
      await db.insert(s.userNotification).values({
        tenantId,
        userId: guardianUser,
        kind: "guardian_message.received",
        title: render(template.subject, fields),
        body: `From ${m.senderName}, ${m.senderRole}`,
        href: "/my/messages",
        createdAt: sentAt,
      });
  }

  const [{ n: missing }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.guardian)
    .where(
      and(eq(s.guardian.tenantId, tenantId), eq(s.guardian.isPrimary, true), isNull(s.guardian.email)),
    )) as [{ n: number }];
  log(
    `communication: ${ANNOUNCEMENTS.length} notices, ${receiptCount} receipts, ${outboxCount} notice emails, ${messages.length} guardian messages (${missing} guardians without email)`,
  );
}
