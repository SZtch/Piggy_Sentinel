#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Piggy Sentinel — Deploy Contracts to Fork
# ─────────────────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/packages/contracts"
RPC="http://localhost:8545"

DEPLOYER_PK="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
DEPLOYER_ADDR="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
AGENT_ADDR="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
AGENT_PK="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
TREASURY_ADDR="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"

echo ""
echo "🐷 Piggy Sentinel — Deploy to Fork"
echo "────────────────────────────────────"

# cek fork
if ! curl -s "$RPC" -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' 2>/dev/null | grep -q "0xa4ec"; then
  echo "❌  Fork tidak running — jalankan: ./scripts/fork/start-fork.sh"; exit 1
fi
echo "  ✅ Fork OK (chainId 42220)"

# cek forge
command -v forge &>/dev/null || { echo "❌  forge not found — foundryup"; exit 1; }

# install forge-std
cd "$CONTRACTS_DIR"
if [ ! -d "lib/forge-std" ]; then
  echo "  📦 forge install forge-std..."
  forge install foundry-rs/forge-std --no-commit --quiet
fi

# build
echo "  🔨 forge build..."
forge build --silent && echo "  ✅ Build OK"

# deploy
echo "  🚀 Deploying..."
DEPLOY_OUTPUT=$(
  DEPLOYER_ADDRESS="$DEPLOYER_ADDR" \
  AGENT_SIGNER_ADDRESS="$AGENT_ADDR" \
  TREASURY_ADDRESS="$TREASURY_ADDR" \
  CELO_RPC_URL_MAINNET="$RPC" \
  forge script script/Deploy.s.sol:Deploy \
    --rpc-url "$RPC" \
    --private-key "$DEPLOYER_PK" \
    --broadcast \
    --legacy \
    2>&1
)

echo "$DEPLOY_OUTPUT" | grep -E "SentinelExecutor :|AaveAdapter :|MentoAdapter :|UniswapAdapter :|AaveOracleWrapper:" || true

# parse addresses
SENTINEL=$(echo "$DEPLOY_OUTPUT"     | grep "SentinelExecutor :" | grep -oE "0x[0-9a-fA-F]{40}" | tail -1)
AAVE_ADAPTER=$(echo "$DEPLOY_OUTPUT" | grep "AaveAdapter :"      | grep -oE "0x[0-9a-fA-F]{40}" | tail -1)
MENTO_ADAPTER=$(echo "$DEPLOY_OUTPUT"| grep "MentoAdapter :"     | grep -oE "0x[0-9a-fA-F]{40}" | tail -1)
UNISWAP_ADAPTER=$(echo "$DEPLOY_OUTPUT"| grep "UniswapAdapter :" | grep -oE "0x[0-9a-fA-F]{40}" | tail -1)
ORACLE_WRAPPER=$(echo "$DEPLOY_OUTPUT" | grep "AaveOracleWrapper:" | grep -oE "0x[0-9a-fA-F]{40}" | tail -1)

if [ -z "$SENTINEL" ]; then
  echo ""; echo "❌  Deploy gagal — output:"; echo "$DEPLOY_OUTPUT" | tail -20; exit 1
fi

echo ""; echo "  ✅ Addresses:"
echo "     SentinelExecutor  : $SENTINEL"
echo "     AaveAdapter       : $AAVE_ADAPTER"
echo "     MentoAdapter      : $MENTO_ADAPTER"
echo "     UniswapAdapter    : $UNISWAP_ADAPTER"
echo "     AaveOracleWrapper : $ORACLE_WRAPPER"

# write .env
cat > "$ROOT_DIR/.env" << ENV
APP_ENV=fork
NODE_ENV=development
ENABLE_MAINNET_EXECUTION=true
CELO_RPC_URL_MAINNET=http://localhost:8545
CELO_RPC_URL_SEPOLIA=https://alfajores-forno.celo-testnet.org
AGENT_SIGNER_PRIVATE_KEY=${AGENT_PK}
AGENT_SIGNER_ADDRESS=${AGENT_ADDR}
TREASURY_ADDRESS=${TREASURY_ADDR}
SENTINEL_EXECUTOR_ADDRESS=${SENTINEL}
AAVE_ADAPTER_ADDRESS=${AAVE_ADAPTER}
MENTO_ADAPTER_ADDRESS=${MENTO_ADAPTER}
UNISWAP_ADAPTER_ADDRESS=${UNISWAP_ADAPTER}
AAVE_ORACLE_WRAPPER_ADDRESS=${ORACLE_WRAPPER}
A_USDC_ADDRESS=0xFF8309b9e99bfd2D4021bc71a362aBD93dBd4785
A_USDT_ADDRESS=0xDeE98402A302e4D707fB9bf2bac66fAEEc31e8Df
A_USDM_ADDRESS=0xBba98352628B0B0c4b40583F593fFCb630935a45
UNISWAP_USDC_WETH_POOL=0x2d70Cbabf4D8e61d5317B62cBF8C90B342b7d2e2
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/piggysentinel_fork
REDIS_URL=redis://localhost:6379
MAX_GAS_PRICE_GWEI=50
MAX_GAS_COST_USD=0.50
TYPICAL_REBALANCE_GAS=300000
MAX_GAS_PER_TX=800000
APY_USDM=1.07
APY_USDC=2.61
APY_USDT=8.89
ETH_PRICE_USD=3000
CIRCUIT_BREAKER_VOLATILITY_PCT=15.0
TELEGRAM_BOT_TOKEN=dev_no_token
DEPLOYER_ADDRESS=${DEPLOYER_ADDR}
USE_OPENCLAW_STRATEGY=false
# CLAUDE_API_KEY=sk-ant-...
ENV

echo "  ✅ .env ditulis"

# forge test
echo ""; echo "  🧪 Running fork tests..."
SENTINEL_EXECUTOR_ADDRESS="$SENTINEL" \
forge test \
  --match-path test/ForkFullFlow.t.sol \
  --fork-url "$RPC" \
  -vv 2>&1 | grep -E "\[PASS\]|\[FAIL\]|Suite|Ran|FAILED"

echo ""
echo "──────────────────────────────────────────"
echo "✅  Deploy + tests done!"
echo ""
echo "   Next: jalankan services"
echo "   pnpm dev:api && pnpm dev:scheduler"
echo ""
