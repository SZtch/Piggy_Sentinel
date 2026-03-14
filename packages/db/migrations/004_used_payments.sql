-- ── x402 Replay Protection ────────────────────────────────────────────────────
--
-- Menyimpan txHash yang sudah dipakai untuk bayar chat API.
-- Satu txHash hanya boleh dipakai 1x — kalau dipakai lagi ditolak (replay attack).\
--
-- Column names harus match dengan Drizzle schema di schema.ts:
--   tx_hash       → usedPayments.txHash
--   payer_address → usedPayments.payerAddress   ← FIX: was "payer", causes INSERT failure
--   amount_usdc   → usedPayments.amountUsdc
--   created_at    → usedPayments.createdAt       ← FIX: was "used_at", schema uses created_at

CREATE TABLE IF NOT EXISTS used_payments (
  tx_hash       TEXT PRIMARY KEY,              -- 0x + 64 hex chars
  payer_address TEXT NOT NULL,                 -- address yang bayar
  amount_usdc   NUMERIC(12, 6),               -- jumlah yang dibayar (untuk audit)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index untuk cleanup job (hapus data > 30 hari)
CREATE INDEX IF NOT EXISTS idx_used_payments_created_at ON used_payments(created_at);
