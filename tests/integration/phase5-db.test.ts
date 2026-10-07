import { neon } from "@neondatabase/serverless";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { beforeAll, describe, expect, it } from "vitest";
import * as s from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  loadAnnouncement,
  loadEngagement,
  loadPublished,
  loadRecipientStudents,
} from "@/domains/announcements/load";
import { dispatchDue } from "@/domains/notifications/outbox";
import { ANNOUNCEMENTS } from "@/lib/demo/announcements";
import { DEMO_NOW } from "@/lib/demo/base";
import { DEMO_TENANT, OTHER_TENANT } from "@/lib/demo/org";
import { SEED_USERS } from "@/lib/demo/personas";

const db = drizzle({ client: neon(process.env.TEST_DATABASE_URL!), schema: s, casing: "snake_case" });

let demo = "";
let other = "";

async function userId(key: string) {
  const email = SEED_USERS.find((u) => u.key === key)!.email.toLowerCase();
  const [row] = await db.select({ id: s.appUser.id }).from(s.appUser).where(eq(s.appUser.email, email));
  return row!.id;
}

async function failure(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code ?? "unknown";
  }
}

async function noticeId(seedKey: string) {
  const [rows] = await withTenant(db, demo, (q) => [
    q.select({ id: s.announcement.id }).from(s.announcement).where(eq(s.announcement.seedKey, seedKey)),
  ]);
  return rows[0]!.id;
}

const transition = (id: string, to: string, by: string, note: string | null = null) =>
  withTenant(db, demo, (q) => [
    q.execute(
      sql`select announcement_transition(${id}::uuid, ${to}::announcement_status, ${by}::uuid, ${note}, ${DEMO_NOW.toISOString()}::timestamptz)`,
    ),
  ]);

beforeAll(async () => {
  const tenants = await db.select({ id: s.tenant.id, slug: s.tenant.slug }).from(s.tenant);
  demo = tenants.find((t) => t.slug === DEMO_TENANT.slug)!.id;
  other = tenants.find((t) => t.slug === OTHER_TENANT.slug)!.id;
});

describe("communication tables under row-level security", () => {
  it("confines notices, receipts, messages and the outbox to the tenant", async () => {
    const count = (tenantId: string) =>
      withTenant(db, tenantId, (q) => [
        q.select({ n: sql<number>`count(*)::int` }).from(s.announcement),
        q.select({ n: sql<number>`count(*)::int` }).from(s.announcementReceipt),
        q.select({ n: sql<number>`count(*)::int` }).from(s.guardianMessage),
        q.select({ n: sql<number>`count(*)::int` }).from(s.notificationOutbox),
      ]).then((rs) => rs.map((r) => r[0]!.n));
    expect((await count(demo)).every((n) => n > 0)).toBe(true);
    expect(await count(other)).toEqual([0, 0, 0, 0]);
  });
});

describe("seeded notices", () => {
  it("writes every seed notice once, in its state, with recipients for the published ones", async () => {
    const published = await loadPublished(db, demo);
    expect(published.length).toBe(ANNOUNCEMENTS.filter((a) => a.status === "published").length);
    const see = published.find((a) => a.title.startsWith("Semester End Examinations"))!;
    const students = await loadRecipientStudents(db, demo);
    const e = await loadEngagement(db, demo, see.id);
    const delivered = e.rows.filter((r) => r.kind === "student").reduce((n, r) => n + r.delivered, 0);
    expect(delivered).toBe(students.length);
    expect(see.attachments[0]?.contentType).toBe("application/pdf");
  });
});

describe("announcement workflow in the database", () => {
  it("never lets an author approve their own notice, and decides a pending notice once", async () => {
    const id = await noticeId("an-cse-electives");
    const author = await userId("programme_coordinator");
    const hod = await userId("hod_cse");
    expect(await failure(transition(id, "published", author))).toBe("42501");
    await transition(id, "published", hod);
    expect(await failure(transition(id, "rejected", hod, "late"))).toBe("55000");
    expect((await loadAnnouncement(db, demo, id))!.status).toBe("published");
  });

  it("freezes a published notice: no edits, no new attachments, no deletion", async () => {
    const id = await noticeId("an-rain-advisory");
    expect(
      await failure(
        withTenant(db, demo, (q) => [
          q.update(s.announcement).set({ title: "Edited" }).where(eq(s.announcement.id, id)),
        ]),
      ),
    ).toBe("55000");
    expect(
      await failure(
        withTenant(db, demo, (q) => [
          q.insert(s.announcementAttachment).values({
            tenantId: demo,
            announcementId: id,
            fileName: "x.pdf",
            contentType: "application/pdf",
            sizeBytes: 4,
            sha256: "x",
            contentBase64: "JVBERg==",
          }),
        ]),
      ),
    ).toBe("55000");
    expect(
      await failure(withTenant(db, demo, (q) => [q.delete(s.announcement).where(eq(s.announcement.id, id))])),
    ).toBe("55000");
  });

  it("lets only the author reopen a returned notice, then edit it as a draft", async () => {
    const id = await noticeId("an-hall-ticket-photo");
    const coe = await userId("exam_controller");
    const principal = await userId("principal");
    await transition(id, "rejected", principal, "Add the photo specification.");
    expect(await failure(transition(id, "draft", principal))).toBe("42501");
    await transition(id, "draft", coe);
    await withTenant(db, demo, (q) => [
      q.update(s.announcement).set({ summary: "Revised summary" }).where(eq(s.announcement.id, id)),
    ]);
    expect((await loadAnnouncement(db, demo, id))!.summary).toBe("Revised summary");
  });

  it("publishes a scheduled notice at its scheduled time and freezes the schedule", async () => {
    const id = await noticeId("an-lab-records");
    const kavya = await userId("class_incharge");
    const at = new Date("2026-10-08T08:00:00+05:30");
    await withTenant(db, demo, (q) => [
      q.update(s.announcement).set({ scheduledFor: at }).where(eq(s.announcement.id, id)),
    ]);
    await transition(id, "published", kavya);
    const a = await loadAnnouncement(db, demo, id);
    expect(a!.status).toBe("published");
    expect(a!.publishedAt).toBe(at.toISOString());
    expect(
      await failure(
        withTenant(db, demo, (q) => [
          q.update(s.announcement).set({ scheduledFor: null }).where(eq(s.announcement.id, id)),
        ]),
      ),
    ).toBe("55000");
  });

  it("withdraws a published notice once", async () => {
    const id = await noticeId("an-library");
    const principal = await userId("principal");
    await transition(id, "withdrawn", principal, "Superseded");
    expect(await failure(transition(id, "withdrawn", principal, "again"))).toBe("55000");
    expect((await loadPublished(db, demo)).some((a) => a.id === id)).toBe(false);
  });
});

describe("guardian messages and the outbox", () => {
  it("records last night's message as held until 07:00, then releases it", async () => {
    const [held] = await withTenant(db, demo, (q) => [
      q
        .select({ id: s.notificationOutbox.id, notBefore: s.notificationOutbox.notBefore })
        .from(s.notificationOutbox)
        .where(
          and(
            eq(s.notificationOutbox.status, "held"),
            eq(s.notificationOutbox.sourceType, "guardian_message"),
          ),
        ),
    ]);
    expect(held.length).toBe(1);
    expect(held[0]!.notBefore.toISOString()).toBe(new Date("2026-10-06T07:00:00+05:30").toISOString());

    const early = await dispatchDue(db, demo, new Date("2026-10-06T06:00:00+05:30"));
    expect(early.sent).toBe(0);
    const result = await dispatchDue(db, demo, DEMO_NOW);
    expect(result.sent).toBeGreaterThanOrEqual(1);
    const [after] = await withTenant(db, demo, (q) => [
      q
        .select({ status: s.notificationOutbox.status, transport: s.notificationOutbox.transport })
        .from(s.notificationOutbox)
        .where(eq(s.notificationOutbox.id, held[0]!.id)),
    ]);
    expect(after[0]).toEqual({ status: "sent", transport: "log" });
  });

  it("rejects a reply without an acknowledgement", async () => {
    const [rows] = await withTenant(db, demo, (q) => [
      q
        .select({ id: s.guardianMessage.id })
        .from(s.guardianMessage)
        .where(sql`${s.guardianMessage.acknowledgedAt} is null`)
        .limit(1),
    ]);
    expect(
      await failure(
        withTenant(db, demo, (q) => [
          q.update(s.guardianMessage).set({ reply: "hi" }).where(eq(s.guardianMessage.id, rows[0]!.id)),
        ]),
      ),
    ).toBe("23514");
  });
});
