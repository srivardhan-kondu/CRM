import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../src/db/schema";
import { databaseUrl } from "./db-target";
import { seed } from "./seed-lib";

async function main() {
  const { url, label } = databaseUrl();
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required to seed (demo passwords derive from it).");
  const db = drizzle({ client: neon(url), schema, casing: "snake_case" });
  await seed(db, {
    secret,
    demoPasswords: process.env.CAMPUSOS_DEMO_MODE === "true",
    bootstrapAdminEmail: process.env.CAMPUSOS_BOOTSTRAP_ADMIN_EMAIL || undefined,
    log: (m) => console.log(`  ${m}`),
  });
  console.log(`✓ seeded ${label} (synthetic data)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
