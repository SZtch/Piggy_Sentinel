#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// @piggy/db — Migration Runner
// Usage: pnpm --filter @piggy/db migrate
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌  DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

async function migrate() {
  console.log("\n🐷 PiggySentinel — Running migrations\n");

  const migrationFile = join(__dirname, "../migrations/0001_init.sql");
  const migrationSQL  = readFileSync(migrationFile, "utf-8");

  try {
    await sql.unsafe(migrationSQL);
    console.log("  ✅ 0001_init.sql applied");
  } catch (err) {
    console.error("  ❌ Migration failed:", err);
    await sql.end();
    process.exit(1);
  }

  await sql.end();
  console.log("\n✅  Migrations complete\n");
}

migrate();
