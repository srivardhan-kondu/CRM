import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Neon Postgres over the serverless HTTP driver + Drizzle. Multi-statement writes use `db.batch([...])`,
 * which Neon executes as a single transaction. Created lazily so builds don't need a database.
 */
export type Db = NeonHttpDatabase<typeof schema>;

let db: Db | null = null;

export function getDb(): Db {
  if (!db) db = drizzle({ client: neon(env().DATABASE_URL), schema, casing: "snake_case" });
  return db;
}
