#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Piggy Sentinel — Celo Mainnet Fork
#
# Menjalankan Anvil sebagai local fork dari Celo mainnet.
# Semua state (token balances, contract code, Aave pools, Mento) di-clone
# dari block terbaru — transaksi lokal tidak broadcast ke mainnet.
#
# Usage:
#   ./scripts/fork/start-fork.sh              # fork dari block terbaru
#   ./scripts/fork/start-fork.sh 31000000     # fork dari block spesifik
#
# Requirements:
#   - foundry (anvil): https://getfoundry.sh
#   - .env di root sudah diisi (lihat .env.example)
# ─────────────────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load .env kalau ada
if [ -f "$ROOT_DIR/.env" ]; then
  export $(grep -v '^#' "$ROOT_DIR/.env" | grep -v '^$' | xargs)
  echo "✅  .env loaded"
else
  echo "⚠️   .env not found — using defaults (some features may not work)"
fi

# ── Config ────────────────────────────────────────────────────────────────────
RPC_URL="${CELO_RPC_URL_MAINNET:-https://forno.celo.org}"
CHAIN_ID=42220
PORT=8545
BLOCK_TIME=5           # detik antar block (mirip Celo mainnet)
FORK_BLOCK="${1:-}"    # opsional: pin ke block tertentu

# ── Funded test wallets (Anvil default accounts) ─────────────────────────────
# Private key tersedia otomatis di Anvil — jangan pakai di mainnet nyata
TEST_WALLET_0="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"  # anvil account 0
TEST_WALLET_1="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"  # anvil account 1

echo ""
echo "🐷 Piggy Sentinel — Celo Mainnet Fork"
echo "────────────────────────────────────────"
echo "  RPC source : $RPC_URL"
echo "  Chain ID   : $CHAIN_ID"
echo "  Local port : $PORT"
echo "  Block time : ${BLOCK_TIME}s"
if [ -n "$FORK_BLOCK" ]; then
  echo "  Fork block : $FORK_BLOCK (pinned)"
else
  echo "  Fork block : latest"
fi
echo ""

# ── Cek anvil tersedia ────────────────────────────────────────────────────────
if ! command -v anvil &> /dev/null; then
  echo "❌  anvil not found."
  echo "   Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup"
  exit 1
fi

ANVIL_VERSION=$(anvil --version 2>&1 | head -1)
echo "   anvil: $ANVIL_VERSION"
echo ""

# ── Build args ────────────────────────────────────────────────────────────────
ANVIL_ARGS=(
  "--fork-url"     "$RPC_URL"
  "--chain-id"     "$CHAIN_ID"
  "--port"         "$PORT"
  "--block-time"   "$BLOCK_TIME"
  "--accounts"     "10"
  "--balance"      "10000"            # 10000 CELO per test wallet
  "--no-mining"                       # manual mining → lebih realistis
  "--order"        "fifo"
)

# Pin ke block spesifik (reproducible tests)
if [ -n "$FORK_BLOCK" ]; then
  ANVIL_ARGS+=("--fork-block-number" "$FORK_BLOCK")
fi

# ── Print test accounts ───────────────────────────────────────────────────────
echo "📋 Test accounts (DO NOT use on mainnet):"
echo "   [0] $TEST_WALLET_0"
echo "   [1] $TEST_WALLET_1"
echo ""
echo "   After fork starts, run:"
echo "   ./scripts/fork/fund-wallets.sh   ← fund wallets with USDm/USDC/USDT"
echo "   ./scripts/fork/deploy-to-fork.sh ← deploy contracts ke fork"
echo ""
echo "   RPC for your app: http://localhost:$PORT"
echo ""
echo "─── Starting anvil ──────────────────────────────────────────────────────"
echo ""

exec anvil "${ANVIL_ARGS[@]}"
