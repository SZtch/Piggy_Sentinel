#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Piggy Sentinel — Fork Health Check
#
# Verifikasi bahwa Celo mainnet fork berjalan dengan benar:
#   - Chain ID = 42220
#   - Block number wajar
#   - Token contracts readable (USDm, USDC, USDT)
#   - Aave aTokens readable
#   - Mento exchange registry readable
#
# Usage:
#   ./scripts/fork/check-fork.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

RPC="http://localhost:8545"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC}  $1"; }
fail() { echo -e "  ${RED}❌${NC}  $1"; FAILED=1; }
warn() { echo -e "  ${YELLOW}⚠️ ${NC}  $1"; }

FAILED=0

rpc_call() {
  curl -s -X POST "$RPC" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"$1\",\"params\":$2,\"id\":1}"
}

eth_call() {
  local to="$1"
  local data="$2"
  rpc_call "eth_call" "[{\"to\":\"$to\",\"data\":\"$data\"},\"latest\"]" \
    | python3 -c "import sys,json; r=json.load(sys.stdin).get('result','0x'); print(int(r,16) if r and r!='0x' else 0)" 2>/dev/null
}

echo ""
echo "🐷 Piggy Sentinel — Fork Health Check"
echo "────────────────────────────────────────"
echo ""

# ── 1. Chain ID ───────────────────────────────────────────────────────────────
echo "Chain:"
CHAIN_ID_HEX=$(rpc_call "eth_chainId" "[]" | python3 -c "import sys,json; print(json.load(sys.stdin)['result'])")
CHAIN_ID=$((16#${CHAIN_ID_HEX#0x}))
if [ "$CHAIN_ID" = "42220" ]; then
  pass "Chain ID: $CHAIN_ID (Celo mainnet ✓)"
else
  fail "Chain ID: $CHAIN_ID (expected 42220)"
fi

# ── 2. Block number ───────────────────────────────────────────────────────────
BLOCK_HEX=$(rpc_call "eth_blockNumber" "[]" | python3 -c "import sys,json; print(json.load(sys.stdin)['result'])")
BLOCK=$((16#${BLOCK_HEX#0x}))
if [ "$BLOCK" -gt "30000000" ]; then
  pass "Block number: $BLOCK (looks like mainnet)"
else
  warn "Block number: $BLOCK (surprisingly low — is this really a mainnet fork?)"
fi

echo ""
echo "Token contracts (Celo mainnet):"

# ── 3. Token symbol reads ────────────────────────────────────────────────────
# symbol() = 0x95d89b41

USDM="0x765DE816845861e75A25fCA122bb6898B8B1282a"
USDC="0xcebA9300f2b948710d2653dD7B07f33A8B32118C"
USDT="0x617f3112bf5397D0467D315cC709EF968D9ba546"

check_token() {
  local name="$1"
  local addr="$2"
  local total
  total=$(eth_call "$addr" "0x18160ddd")   # totalSupply()
  if [ "$total" -gt "0" ]; then
    local supply_human
    supply_human=$(python3 -c "print(f'{$total / 1e18:,.0f}' if '$name' == 'USDm' else f'{$total / 1e6:,.0f}')")
    pass "$name ($addr): totalSupply = $supply_human"
  else
    fail "$name ($addr): totalSupply = 0 (contract not readable)"
  fi
}

check_token "USDm" "$USDM"
check_token "USDC" "$USDC"
check_token "USDT" "$USDT"

echo ""
echo "Aave aTokens:"

A_USDC="0xFF8309b9e99bfd2D4021bc71a362aBD93dBd4785"
A_USDT="0xDeE98402A302e4D707fB9bf2bac66fAEEc31e8Df"
A_USDM="0xBba98352628B0B0c4b40583F593fFCb630935a45"

check_atoken() {
  local name="$1"
  local addr="$2"
  local supply
  supply=$(eth_call "$addr" "0x18160ddd")
  if [ "$supply" -gt "0" ]; then
    pass "$name ($addr): readable ✓"
  else
    warn "$name ($addr): totalSupply = 0 (Aave pool may not have this asset yet)"
  fi
}

check_atoken "aUSDC" "$A_USDC"
check_atoken "aUSDT" "$A_USDT"
check_atoken "aUSDm" "$A_USDM"

echo ""
echo "Uniswap V3 Pool (USDC/WETH):"

UNIV3_POOL="0x2d70Cbabf4D8e61d5317B62cBF8C90B342b7d2e2"
# slot0() = 0x3850c7bd
SLOT0=$(rpc_call "eth_call" "[{\"to\":\"$UNIV3_POOL\",\"data\":\"0x3850c7bd\"},\"latest\"]" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',''))" 2>/dev/null)
if [ ${#SLOT0} -gt 10 ]; then
  # Decode sqrtPriceX96 (first 32 bytes after 0x)
  SQRT_PRICE_HEX="${SLOT0:2:64}"
  SQRT_PRICE=$((16#$SQRT_PRICE_HEX))
  if [ "$SQRT_PRICE" -gt "0" ]; then
    pass "Uniswap V3 USDC/WETH pool: readable, sqrtPriceX96 = ${SQRT_PRICE_HEX:0:16}..."
  else
    warn "Uniswap V3 pool: sqrtPriceX96 = 0"
  fi
else
  fail "Uniswap V3 pool: not readable"
fi

echo ""
echo "────────────────────────────────────────"
if [ "$FAILED" = "0" ]; then
  echo -e "${GREEN}✅  Fork healthy — semua checks passed${NC}"
  echo ""
  echo "   Next steps:"
  echo "   1. Fund wallets : ./scripts/fork/fund-wallets.sh"
  echo "   2. Deploy       : ./scripts/fork/deploy-to-fork.sh"
  echo "   3. Run services : cp .env.fork .env && pnpm dev:api"
else
  echo -e "${RED}❌  Some checks failed — fork mungkin belum siap${NC}"
  echo ""
  echo "   Pastikan anvil berjalan:"
  echo "   ./scripts/fork/start-fork.sh"
fi
echo ""
