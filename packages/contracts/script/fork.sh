#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# fork.sh — Jalankan Celo Mainnet fork lokal pakai Anvil
#
# Cara pakai:
#   chmod +x script/fork.sh
#   ./script/fork.sh
#
# Setelah jalan, buka terminal baru dan jalankan test:
#   forge test --match-path test/ForkFullFlow.t.sol -vvv
# ─────────────────────────────────────────────────────────────────────────────

set -e

CELO_RPC="${CELO_RPC_URL_MAINNET:-https://forno.celo.org}"
PORT=8545

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  PiggySentinel — Celo Mainnet Fork"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  RPC   : $CELO_RPC"
echo "  Port  : $PORT"
echo "  Chain : 42220 (Celo Mainnet fork)"
echo ""
echo "  Semua protocol sudah ada:"
echo "  ✅ Aave V3   → 0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402"
echo "  ✅ Mento     → 0x777A8255cA72412f0d706dc03C9D1987306B4CaD"
echo "  ✅ Uniswap   → 0x3d2bD0e15829AA5C362a4144FdF4A1112fa29B5c"
echo ""
echo "  Jalankan test di terminal lain:"
echo "  forge test --match-path test/ForkFullFlow.t.sol -vvv"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

anvil \
  --fork-url "$CELO_RPC" \
  --chain-id 42220 \
  --port $PORT \
  --block-time 5 \
  --accounts 10 \
  --balance 10000
