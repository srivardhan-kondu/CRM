import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import * as schema from "../../src/db/schema";
import { seed } from "../../scripts/seed-lib";

/**
 * Rebuilds the isolated test database from nothing: drop → create → migrate → seed.
 * Doubles as the "migrations apply cleanly to an empty database" check (PRD §30.9).
 */
export async function resetTestDatabase(opts: { demoPasswords: boolean; secret: string }) {
  const admin = process.env.DATABASE_URL;
  const test = process.env.TEST_DATABASE_URL;
  if (!admin || !test) throw new Error("Tests need DATABASE_URL and TEST_DATABASE_URL (see .env.example).");
  const testDb = new URL(test).pathname.slice(1);
  if (!/^campusos_test/.test(testDb))
    throw new Error(`Refusing to reset "${testDb}": test database names must start with campusos_test.`);

  const sql = neon(admin);
  await sql.query(`DROP DATABASE IF EXISTS ${testDb} WITH (FORCE)`);
  await sql.query(`CREATE DATABASE ${testDb}`);

  const db = drizzle({
    client: neon(process.env.TEST_DATABASE_URL_UNPOOLED ?? test),
    schema,
    casing: "snake_case",
  });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed(db, opts);
}

export default async function setup() {
  await resetTestDatabase({ secret: "integration-test-secret-integration-test", demoPasswords: false });
}
