import { resetTestDatabase } from "../tests/integration/global-setup";

/** E2E runs against a freshly rebuilt test database with demo personas, never the app database. */
export default async function setup() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required for E2E (demo passwords derive from it).");
  await resetTestDatabase({ secret, demoPasswords: true });
}
