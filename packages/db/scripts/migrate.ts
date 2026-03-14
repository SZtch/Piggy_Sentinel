import { readdir, readFile } from "node:fs/promises";
import { join, dirname }     from "node:path";
import { fileURLToPath }     from "node:url";
import postgres               from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR       = join(__dirname, "../migrations");

async function migrate() {
  const db = postgres(process.env.DATABASE_URL!);

  await db.unsafe("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");

  const rows = await db.unsafe("SELECT name FROM _migrations");
  const applied = new Set(rows.map((r: any) => r.name as string));

  const files = (await readdir(DIR))
    .filter((f) => f.endsWith(".sql") && !f.includes(".down."))
    .sort();

  for (const file of files) {
    if (applied.has(file)) { console.log("skip: " + file); continue; }
    const content = await readFile(join(DIR, file), "utf-8");
    console.log("run: " + file);
    const cleaned = content
      .replace(/^\s*BEGIN\s*;/gim, "")
      .replace(/^\s*COMMIT\s*;/gim, "")
      .trim();
    await db.unsafe(cleaned);
    await db.unsafe("INSERT INTO _migrations (name) VALUES ($1)", [file]);
  }

  console.log("Migrations complete.");
  await db.end();
}

migrate().catch((err) => { console.error(err); process.exit(1); });
