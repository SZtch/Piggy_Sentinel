import { readdir, readFile } from "node:fs/promises";
import { join, dirname }     from "node:path";
import { fileURLToPath }     from "node:url";
import { db }                from "./client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR       = join(__dirname, "../migrations");

async function migrate() {
  await db`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

  const applied = new Set(
    (await db`SELECT name FROM _migrations`).map((r) => r.name as string)
  );

  const files = (await readdir(DIR)).filter((f) => f.endsWith(".sql") && !f.includes(".down.")).sort();

  for (const file of files) {
    if (applied.has(file)) { console.log(`  skip: ${file}`); continue; }
    const sql = await readFile(join(DIR, file), "utf-8");
    console.log(`  run:  ${file}`);
    const cleaned = sql.replace(/^\s*BEGIN\s*;/gim, "").replace(/^\s*COMMIT\s*;/gim, "").trim();
    await db.unsafe(cleaned);
    await db`INSERT INTO _migrations (name) VALUES (${file})`;
  }

  console.log("Migrations complete.");
  await db.end();
}

migrate().catch((err) => { console.error(err); process.exit(1); });
