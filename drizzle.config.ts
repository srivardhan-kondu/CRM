import { defineConfig } from "drizzle-kit";

// Migrations run against the direct (unpooled) Neon connection.
// Point MIGRATE_DATABASE_URL at another database (e.g. the test database) to migrate it instead.
export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: {
    url:
      process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
