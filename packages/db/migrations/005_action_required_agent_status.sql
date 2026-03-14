-- ── Migration 005: action_required, expired status + agent_events ────────────
--
-- 1. Goal status sekarang support: action_required, expired
-- 2. Tambah kolom action_reason di goals — penjelasan kenapa action required
-- 3. Tambah kolom allowance_expires_at di goals — untuk expiry tracking
-- 4. Tabel agent_events — track agent status: idle/running/blocked/success/failed

-- ── 1. Tambah kolom ke goals ──────────────────────────────────────────────────
ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS action_reason      TEXT,
  ADD COLUMN IF NOT EXISTS allowance_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_allowance_check TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS goal_name          TEXT;

-- ── 2. Tabel agent_events ─────────────────────────────────────────────────────
-- Menyimpan status agent per cycle, terpisah dari goal status.
-- Agent status: idle | running | blocked | success | failed
CREATE TABLE IF NOT EXISTS agent_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id      UUID NOT NULL REFERENCES goals(id),
  agent_wallet TEXT NOT NULL,
  status       TEXT NOT NULL,           -- idle | running | blocked | success | failed
  reason       TEXT,                    -- penjelasan singkat (untuk blocked/failed)
  cycle_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_events_goal   ON agent_events(goal_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_status ON agent_events(status);
CREATE INDEX IF NOT EXISTS idx_agent_events_cycle  ON agent_events(cycle_at DESC);

-- ── 3. Notif types baru ───────────────────────────────────────────────────────
-- Tidak perlu ALTER TABLE karena notification_type adalah TEXT bebas.
-- Types baru yang akan digunakan:
--   allowance_revoked   — user cabut allowance
--   balance_insufficient — saldo tidak cukup untuk cycle
--   goal_action_required — general action required state
--   goal_expired         — deadline terlewat, goal belum selesai
--   x402_charged         — user kena charge micropayment
--   goal_completed_options — goal selesai, user perlu pilih tindakan
