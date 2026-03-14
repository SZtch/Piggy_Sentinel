-- ─────────────────────────────────────────────────────────────────────────────
-- PiggySentinel — Initial Migration
-- Run: psql $DATABASE_URL -f packages/db/migrations/0001_init.sql
--   or: pnpm --filter @piggy/db migrate
-- ─────────────────────────────────────────────────────────────────────────────

-- users
CREATE TABLE IF NOT EXISTS users (
  wallet_address TEXT PRIMARY KEY,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- agent_wallets
CREATE TABLE IF NOT EXISTS agent_wallets (
  contract_address TEXT PRIMARY KEY,
  owner_wallet     TEXT NOT NULL REFERENCES users(wallet_address),
  executor_address TEXT NOT NULL,
  spend_limit      NUMERIC(78,0) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- goals
CREATE TABLE IF NOT EXISTS goals (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_wallet         TEXT NOT NULL REFERENCES users(wallet_address),
  agent_wallet         TEXT NOT NULL,
  target_amount        NUMERIC(78,0) NOT NULL,
  target_currency      TEXT NOT NULL,
  deadline             TIMESTAMPTZ NOT NULL,
  status               TEXT NOT NULL DEFAULT 'draft',
  strategy_json        JSONB,
  progress_pct         NUMERIC(5,2) DEFAULT 0,
  principal_deposited  NUMERIC(78,0) DEFAULT 0,
  monthly_deposit      NUMERIC(78,0) DEFAULT 0,
  last_rebalanced_at   TIMESTAMPTZ,
  soft_paused          BOOLEAN NOT NULL DEFAULT FALSE,
  epoch_start          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS goals_owner_idx  ON goals(owner_wallet);
CREATE INDEX IF NOT EXISTS goals_status_idx ON goals(status);

-- executions
CREATE TABLE IF NOT EXISTS executions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id      UUID NOT NULL REFERENCES goals(id),
  agent_wallet TEXT NOT NULL,
  skill_name   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  tx_hash      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS executions_goal_idx ON executions(goal_id);

-- snapshots
CREATE TABLE IF NOT EXISTS snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id      UUID NOT NULL REFERENCES goals(id),
  balance      NUMERIC(78,0) NOT NULL,
  progress_pct NUMERIC(5,2) NOT NULL,
  pace_status  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS snapshots_goal_idx ON snapshots(goal_id);

-- notifications
CREATE TABLE IF NOT EXISTS notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id           UUID NOT NULL REFERENCES goals(id),
  telegram_chat_id  TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  message_text      TEXT NOT NULL,
  sent              BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_sent_idx ON notifications(sent);
CREATE INDEX IF NOT EXISTS notifications_goal_idx ON notifications(goal_id);

-- telegram_links
CREATE TABLE IF NOT EXISTS telegram_links (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL REFERENCES users(wallet_address),
  chat_id        TEXT,
  code           TEXT NOT NULL UNIQUE,
  expires_at     TIMESTAMPTZ NOT NULL,
  confirmed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS telegram_links_wallet_idx ON telegram_links(wallet_address);
CREATE INDEX IF NOT EXISTS telegram_links_chat_idx   ON telegram_links(chat_id);

-- used_payments (x402 replay protection)
CREATE TABLE IF NOT EXISTS used_payments (
  tx_hash       TEXT PRIMARY KEY,
  payer_address TEXT NOT NULL,
  amount_usdc   NUMERIC(12,6) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
