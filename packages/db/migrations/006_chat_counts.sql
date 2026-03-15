-- ── Chat message counts per wallet per month ─────────────────────────────
-- Menggantikan in-memory Map di chat.ts yang reset saat server restart.
-- Persistent across restarts dan multi-instance deployment.

CREATE TABLE IF NOT EXISTS chat_counts (
  wallet      TEXT    NOT NULL,
  month       TEXT    NOT NULL,  -- format: "YYYY-M" e.g. "2026-3"
  count       INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (wallet, month)
);

-- Index untuk lookup cepat per wallet
CREATE INDEX IF NOT EXISTS idx_chat_counts_wallet ON chat_counts (wallet);
