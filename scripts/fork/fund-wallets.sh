#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Piggy Sentinel — Fund Test Wallets
#
# Setelah fork berjalan, script ini:
#   1. Impersonate whale wallet (holder USDm/USDC/USDT terbesar)
#   2. Transfer stablecoin ke test wallets
#   3. Verifikasi balance
#
# Usage:
#   ./scripts/fork/fund-wallets.sh
#   ./scripts/fork/fund-wallets.sh 0xYourWallet   # fund wallet custom
#
# Requires: anvil fork sudah running di port 8545
# ─────────────────────────────────────────────────────────────────────────────

set -e

RPC="http://localhost:8545"

# ── Target wallets ────────────────────────────────────────────────────────────
WALLET_0="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"   # anvil account 0
WALLET_1="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"   # anvil account 1
EXTRA_WALLET="${1:-}"

# ── Token addresses (Celo mainnet) ────────────────────────────────────────────
# Source: https://docs.celo.org/token-addresses
USDM_ADDRESS="0x765DE816845861e75A25fCA122bb6898B8B1282a"  # cUSD → proxy untuk USDm
USDC_ADDRESS="0xcebA9300f2b948710d2653dD7B07f33A8B32118C"  # USDC (native via Circle)
USDT_ADDRESS="0x617f3112bf5397D0467D315cC709EF968D9ba546"  # USDT (Tether)

# ── Known whale addresses (mainnet holders) ───────────────────────────────────
# Digunakan hanya untuk impersonation di fork — tidak menyentuh mainnet
USDM_WHALE="0x9F4AdBD0af281C69a2e520A4adeaD7C9c0B7bB44"   # Mento Reserve
USDC_WHALE="0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506"   # Uniswap V3 Router
USDT_WHALE="0xe7804c37c13166fF0b37F5aE0BB07A3aEbb6e245"   # Binance hot wallet (Celo)

# ── Amounts ───────────────────────────────────────────────────────────────────
USDM_AMOUNT="100000000000000000000000"  # 100,000 USDm  (18 dec)
USDC_AMOUNT="100000000000"              # 100,000 USDC   (6 dec)
USDT_AMOUNT="100000000000"              # 100,000 USDT   (6 dec)

ERC20_TRANSFER_SIG="0xa9059cbb"  # transfer(address,uint256)

# ── Helpers ───────────────────────────────────────────────────────────────────
pad32() {
  printf '%064x' "$(python3 -c "print(int('$1', 16))")"
}

pad32_decimal() {
  printf '%064x' "$1"
}

anvil_impersonate() {
  curl -s -X POST "$RPC" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"anvil_impersonateAccount\",\"params\":[\"$1\"],\"id\":1}" \
    > /dev/null
}

anvil_stop_impersonate() {
  curl -s -X POST "$RPC" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"anvil_stopImpersonatingAccount\",\"params\":[\"$1\"],\"id\":1}" \
    > /dev/null
}

fund_celo() {
  local wallet="$1"
  curl -s -X POST "$RPC" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"anvil_setBalance\",\"params\":[\"$wallet\",\"0x52B7D2DCC80CD2E4000000\"],\"id\":1}" \
    > /dev/null
}

erc20_transfer() {
  local token="$1"
  local from="$2"
  local to="$3"
  local amount="$4"

  local to_padded
  to_padded=$(python3 -c "print('000000000000000000000000' + '$to'[2:].lower())")
  local amount_padded
  amount_padded=$(python3 -c "print(hex($amount)[2:].zfill(64))")

  local calldata="${ERC20_TRANSFER_SIG}${to_padded}${amount_padded}"

  curl -s -X POST "$RPC" \
    -H "Content-Type: application/json" \
    -d "{
      \"jsonrpc\": \"2.0\",
      \"method\": \"eth_sendTransaction\",
      \"params\": [{
        \"from\": \"$from\",
        \"to\": \"$token\",
        \"data\": \"$calldata\",
        \"gas\": \"0x30000\"
      }],
      \"id\": 1
    }" > /dev/null
}

get_balance() {
  local token="$1"
  local wallet="$2"
  local wallet_padded
  wallet_padded=$(python3 -c "print('000000000000000000000000' + '$wallet'[2:].lower())")

  local result
  result=$(curl -s -X POST "$RPC" \
    -H "Content-Type: application/json" \
    -d "{
      \"jsonrpc\": \"2.0\",
      \"method\": \"eth_call\",
      \"params\": [{
        \"to\": \"$token\",
        \"data\": \"0x70a08231${wallet_padded}\"
      }, \"latest\"],
      \"id\": 1
    }" | python3 -c "import sys,json; r=json.load(sys.stdin)['result']; print(int(r,16) if r and r != '0x' else 0)")

  echo "$result"
}

fund_wallet() {
  local wallet="$1"
  echo ""
  echo "  💰 Funding: $wallet"

  # CELO native
  fund_celo "$wallet"
  echo "     ✅ CELO: 1,000,000"

  # USDm
  anvil_impersonate "$USDM_WHALE"
  fund_celo "$USDM_WHALE"
  erc20_transfer "$USDM_ADDRESS" "$USDM_WHALE" "$wallet" "$USDM_AMOUNT"
  anvil_stop_impersonate "$USDM_WHALE"
  local usdm_bal
  usdm_bal=$(get_balance "$USDM_ADDRESS" "$wallet")
  echo "     ✅ USDm: $(python3 -c "print(f'{$usdm_bal / 1e18:,.2f}')")"

  # USDC
  anvil_impersonate "$USDC_WHALE"
  fund_celo "$USDC_WHALE"
  erc20_transfer "$USDC_ADDRESS" "$USDC_WHALE" "$wallet" "$USDC_AMOUNT"
  anvil_stop_impersonate "$USDC_WHALE"
  local usdc_bal
  usdc_bal=$(get_balance "$USDC_ADDRESS" "$wallet")
  echo "     ✅ USDC: $(python3 -c "print(f'{$usdc_bal / 1e6:,.2f}')")"

  # USDT
  anvil_impersonate "$USDT_WHALE"
  fund_celo "$USDT_WHALE"
  erc20_transfer "$USDT_ADDRESS" "$USDT_WHALE" "$wallet" "$USDT_AMOUNT"
  anvil_stop_impersonate "$USDT_WHALE"
  local usdt_bal
  usdt_bal=$(get_balance "$USDT_ADDRESS" "$wallet")
  echo "     ✅ USDT: $(python3 -c "print(f'{$usdt_bal / 1e6:,.2f}')")"
}

# ── Cek fork running ──────────────────────────────────────────────────────────
echo ""
echo "🐷 Piggy Sentinel — Fund Test Wallets"
echo "──────────────────────────────────────"

if ! curl -s "$RPC" -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
  | grep -q "0xa4ec"; then
  echo "❌  Anvil fork not running at $RPC"
  echo "   Start it first: ./scripts/fork/start-fork.sh"
  exit 1
fi

echo "  ✅ Fork detected (Celo mainnet, chainId 42220)"

fund_wallet "$WALLET_0"
fund_wallet "$WALLET_1"

if [ -n "$EXTRA_WALLET" ]; then
  fund_wallet "$EXTRA_WALLET"
fi

echo ""
echo "─────────────────────────────────────────"
echo "✅  All wallets funded. Ready to test."
echo ""
echo "   Next step:"
echo "   ./scripts/fork/deploy-to-fork.sh"
echo ""
