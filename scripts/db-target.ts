/** Resolves which database a script operates on: the app database, or the isolated test database with --test. */
export function databaseUrl(): { url: string; label: string } {
  const test = process.argv.includes("--test");
  const url = test
    ? (process.env.TEST_DATABASE_URL_UNPOOLED ?? process.env.TEST_DATABASE_URL)
    : (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
  if (!url) {
    throw new Error(
      `${test ? "TEST_DATABASE_URL" : "DATABASE_URL"} is not set. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return { url, label: test ? "test database" : "app database" };
}
