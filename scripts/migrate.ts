import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { databaseUrl } from "./db-target";

async function main() {
  const { url, label } = databaseUrl();
  const db = drizzle({ client: neon(url), casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log(`✓ migrations applied to ${label}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
