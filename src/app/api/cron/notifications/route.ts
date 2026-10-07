import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { dispatchDue } from "@/domains/notifications/outbox";
import { institutionNow } from "@/lib/clock";

/**
 * Scheduled dispatch of due external messages for every institution (a platform cron calls this every few minutes,
 * e.g. Vercel Cron with `Authorization: Bearer $CRON_SECRET`). Disabled until CRON_SECRET is configured.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = getDb();
  const tenants = await db.select({ id: s.tenant.id, slug: s.tenant.slug }).from(s.tenant);
  const now = institutionNow();
  const results: Record<string, Awaited<ReturnType<typeof dispatchDue>>> = {};
  for (const t of tenants) results[t.slug] = await dispatchDue(db, t.id, now);
  return NextResponse.json({ at: now.toISOString(), results });
}
