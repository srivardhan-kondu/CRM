import "server-only";

import { z } from "zod";

/**
 * Validated server environment, read lazily so `next build` in CI does not need production secrets.
 * The first request that needs a value fails loudly with a clear message if it is missing.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url({ message: "DATABASE_URL must be a Postgres connection URL (Neon pooled)." }),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters (openssl rand -base64 32)."),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  CAMPUSOS_DEMO_MODE: z.enum(["true", "false"]).default("false"),
  /** Deployment environment — distinct from NODE_ENV, which is "production" for any `next start`. */
  CAMPUSOS_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const raw = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, v === "" ? undefined : v]));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid server environment:\n${issues}\nSee .env.example.`);
  }
  if (parsed.data.CAMPUSOS_ENV === "production" && parsed.data.CAMPUSOS_DEMO_MODE === "true") {
    throw new Error("CAMPUSOS_DEMO_MODE must not be enabled when CAMPUSOS_ENV=production.");
  }
  cached = parsed.data;
  return cached;
}

export function googleConfigured(): boolean {
  const e = env();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
}

export function demoModeEnabled(): boolean {
  return env().CAMPUSOS_DEMO_MODE === "true";
}
