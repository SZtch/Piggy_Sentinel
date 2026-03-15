# PiggySentinel — Mainnet Fork Guide

Local Celo Mainnet fork using Anvil. Every mainnet contract is available — Aave V3, Mento, Uniswap V4. No real funds involved. Used for local development and integration testing before deploying to mainnet.

The fork tests in `test/ForkFullFlow.t.sol` run directly against a live Celo Mainnet RPC (no Anvil needed) — 15 tests covering the full lifecycle with real protocol state.

## Prerequisites

```bash
# Install Foundry (includes Anvil + Forge)
curl -L https://foundry.paradigm.xyz | bash && foundryup

# Verify
anvil --version && forge --version
```

## Workflow

### 1. Start the fork

```bash
# Fork from latest block
./scripts/fork/start-fork.sh

# Fork from specific block (reproducible tests)
./scripts/fork/start-fork.sh 31500000
```

Runs at `http://localhost:8545`, Chain ID `42220` (identical to Celo Mainnet).
10 test wallets, 10,000 CELO each.

### 2. Verify the fork is healthy

```bash
./scripts/fork/check-fork.sh
```

### 3. Fund test wallets with stablecoins

```bash
./scripts/fork/fund-wallets.sh

# Or fund a specific wallet
./scripts/fork/fund-wallets.sh 0xYourAddress
```

Each wallet gets 100,000 each: USDm, USDC, USDT.

### 4. Deploy contracts to fork

```bash
./scripts/fork/deploy-to-fork.sh
```

Generates `.env.fork` with all deployed contract addresses.

### 5. Wire it up

```bash
cp .env.fork .env
pnpm dev:api        # API on :3001
pnpm dev:scheduler  # Scheduler
```

## Forge fork tests

Run against live Celo RPC — no Anvil needed:

```bash
forge test \
  --match-path test/ForkFullFlow.t.sol \
  --fork-url https://forno.celo.org \
  -vvv
```

15 tests covering:

- Full deposit → yield → withdraw lifecycle
- Spend limit enforcement and epoch reset
- Proportional yield between multiple users
- Cross-user drain protection
- Circuit breaker + emergency withdraw
- Agent signer timelock (48h)
- Parked funds isolation

## Useful cast commands

```bash
# Check USDm balance
cast call 0x765DE816845861e75A25fCA122bb6898B8B1282a \
  "balanceOf(address)(uint256)" <address> \
  --rpc-url http://localhost:8545

# Check Aave liquidity rate (USDT)
cast call 0x3E59A31363BF5a55D8b31E5b7E59b7B3B14e32B7 \
  "getReserveData(address)((uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128))" \
  0x617f3112bf5397D0467D315cC709EF968D9ba546 \
  --rpc-url http://localhost:8545

# Mine a block manually
cast rpc anvil_mine 1 --rpc-url http://localhost:8545

# Advance time by 30 days
cast rpc anvil_increaseTime 2592000 --rpc-url http://localhost:8545
cast rpc anvil_mine 1 --rpc-url http://localhost:8545

# Reset fork to latest block
cast rpc anvil_reset \
  '{"forking":{"jsonRpcUrl":"https://forno.celo.org"}}' \
  --rpc-url http://localhost:8545
```

## Anvil default test wallets

| # | Address | Private Key |
|---|---------|-------------|
| 0 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` |
| 1 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` |

⚠️ **Never use these private keys on mainnet. Ever.**

## Scripts reference

| Script | Purpose |
|---|---|
| `scripts/fork/start-fork.sh` | Start Anvil fork at latest block (or pass block number) |
| `scripts/fork/check-fork.sh` | Verify fork is healthy and contracts are reachable |
| `scripts/fork/fund-wallets.sh` | Fund test wallets with USDC/USDT/USDm via `deal()` |
| `scripts/fork/deploy-to-fork.sh` | Deploy contracts to fork, outputs `.env.fork` |
| `scripts/fork/setup-all.sh` | Run all of the above in sequence |
