// ─────────────────────────────────────────────────────────────────────────────
// @piggy/db — Database Client
// ─────────────────────────────────────────────────────────────────────────────

import { drizzle }  from "drizzle-orm/postgres-js";
import postgres     from "postgres";
import * as schema  from "./schema.js";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("@piggy/db: DATABASE_URL env var is not set");
}

// Single connection pool shared across the process.
// max: 10 connections — tunable via DB_POOL_MAX env var.
const sql = postgres(DATABASE_URL, {
  max:         parseInt(process.env.DB_POOL_MAX ?? "10"),
  idle_timeout: 30,
  connect_timeout: 10,
  onnotice: () => {}, // suppress NOTICE logs
});

export const db = drizzle(sql, { schema });

export type DB = typeof db;
