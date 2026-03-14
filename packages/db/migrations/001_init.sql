CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  wallet_address  TEXT PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS telegram_links (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address       TEXT REFERENCES users(wallet_address) ON DELETE CASCADE,
  telegram_chat_id     TEXT UNIQUE,
  link_code            TEXT,
  link_code_expires_at TIMESTAMPTZ,
  linked_at            TIMESTAMPTZ,
  active               BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(wallet_address)
);

CREATE TABLE IF NOT EXISTS agent_wallets (
  contract_address    TEXT PRIMARY KEY,
  owner_wallet        TEXT REFERENCES users(wallet_address),
  deployed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  executor_address    TEXT NOT NULL,
  spend_limit         NUMERIC(78,0) NOT NULL DEFAULT 0,
  soft_paused         BOOLEAN NOT NULL DEFAULT false,
  hard_paused_onchain BOOLEAN NOT NULL DEFAULT false,
  last_synced_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS goals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_wallet     TEXT REFERENCES users(wallet_address),
  agent_wallet     TEXT REFERENCES agent_wallets(contract_address),
  target_amount    NUMERIC(78,18) NOT NULL,
  target_currency  TEXT NOT NULL,
  deadline         DATE NOT NULL,
  risk_preference  TEXT NOT NULL DEFAULT 'conservative',
  status           TEXT NOT NULL DEFAULT 'draft',
  strategy_json    JSONB,
  baseline_fx_rate NUMERIC(30,10),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at     TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_goals_owner_status ON goals(owner_wallet, status);

CREATE TABLE IF NOT EXISTS goal_snapshots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id          UUID REFERENCES goals(id) ON DELETE CASCADE,
  snapshot_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atoken_balance   NUMERIC(78,18) NOT NULL,
  progress_pct     NUMERIC(5,2),
  pace_status      TEXT,
  fx_rate          NUMERIC(30,10),
  apy_observed     NUMERIC(8,4)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_goal ON goal_snapshots(goal_id, snapshot_at DESC);

CREATE TABLE IF NOT EXISTS fx_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id            UUID REFERENCES goals(id) ON DELETE CASCADE,
  triggered_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  drift_pct          NUMERIC(8,4),
  from_asset         TEXT NOT NULL,
  to_asset           TEXT NOT NULL,
  amount_in          NUMERIC(78,18),
  amount_out         NUMERIC(78,18),
  tx_hash            TEXT,
  agentscan_event_id TEXT,
  status             TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS execution_history (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id            UUID REFERENCES goals(id) ON DELETE CASCADE,
  agent_wallet       TEXT,
  skill_name         TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending',
  tx_hash            TEXT,
  block_number       BIGINT,
  error_message      TEXT,
  parameters_json    JSONB,
  agentscan_event_id TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_exec_goal ON execution_history(goal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id             UUID REFERENCES goals(id) ON DELETE CASCADE,
  telegram_chat_id    TEXT,
  notification_type   TEXT NOT NULL,
  message_text        TEXT NOT NULL,
  sent_at             TIMESTAMPTZ,
  delivery_status     TEXT NOT NULL DEFAULT 'pending'
);
