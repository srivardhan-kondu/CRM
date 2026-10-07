import { sql } from "drizzle-orm";
import type { BatchItem, BatchResponse } from "drizzle-orm/batch";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type * as schema from "./schema";

type Db = NeonHttpDatabase<typeof schema>;

/** The non-owner role that row-level security binds (migration 0003). */
export const APP_ROLE = "campusos_app";

/**
 * Runs queries in one transaction as `campusos_app` with `app.tenant_id` set, so row-level security confines
 * every statement to the tenant — a missing `where tenant_id = …` returns nothing instead of another
 * institution's rows. All reads and writes of tenant-owned business tables go through here.
 *
 * Neon's HTTP driver executes a batch as a single transaction, and `set_config(…, true)` is transaction-local,
 * so nothing leaks to other requests on a pooled connection.
 */
export async function withTenant<T extends readonly [BatchItem<"pg">, ...BatchItem<"pg">[]]>(
  db: Db,
  tenantId: string,
  queries: (db: Db) => T,
): Promise<BatchResponse<T>> {
  const scope = db.execute(
    sql`select set_config('role', ${APP_ROLE}, true), set_config('app.tenant_id', ${tenantId}, true)`,
  );
  const [, ...results] = await db.batch([scope, ...queries(db)] as const);
  return results as BatchResponse<T>;
}
