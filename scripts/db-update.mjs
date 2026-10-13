// Runs before `next build` on every deployment: applies ADDITIVE database changes (new tables or columns)
// from prisma/schema.prisma. `prisma db push` refuses anything that would lose data, so nothing is ever deleted.
// If it cannot run (for example the database is unreachable at build time) the build carries on, and the
// app falls back to its defaults for anything that is not in the database yet.
import { spawnSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.log("[db-update] DATABASE_URL is not set at build time — skipping the database update.");
  process.exit(0);
}

const result = spawnSync("npx", ["prisma", "db", "push", "--skip-generate"], { stdio: "inherit", env: process.env });
if (result.status === 0) {
  console.log("[db-update] database is up to date.");
} else {
  console.log("[db-update] WARNING: the database update did not run (exit " + result.status + "). The build continues.");
}
process.exit(0);
