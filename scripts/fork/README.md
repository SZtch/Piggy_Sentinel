# Piggy Sentinel — Mainnet Fork Guide

Fork Celo mainnet secara lokal dengan Anvil untuk development dan testing
tanpa menyentuh mainnet yang sebenarnya.

## Prerequisites

```bash
# Install Foundry (anvil + forge)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Verify
anvil --version
forge --version
```

## Workflow

### 1. Start fork

```bash
# Fork dari block terbaru
./scripts/fork/start-fork.sh

# Fork dari block spesifik (reproducible tests)
./scripts/fork/start-fork.sh 31500000
```

Fork akan berjalan di `http://localhost:8545` dengan:
- Chain ID: `42220` (identik dengan Celo mainnet)
- Semua contract mainnet (Aave, Mento, Uniswap) tersedia
- 10 test wallets, masing-masing 10,000 CELO

### 2. Verify fork sehat

```bash
# Terminal baru
./scripts/fork/check-fork.sh
```

### 3. Fund test wallets dengan stablecoin

```bash
./scripts/fork/fund-wallets.sh

# Atau fund wallet custom
./scripts/fork/fund-wallets.sh 0xYourWallet
```

Setiap wallet mendapat:
- 100,000 USDm
- 100,000 USDC
- 100,000 USDT

### 4. Deploy contracts ke fork

```bash
./scripts/fork/deploy-to-fork.sh
```

Akan generate `.env.fork` dengan contract addresses yang baru di-deploy.

### 5. Jalankan services

```bash
cp .env.fork .env
pnpm dev:api        # API on :3001
pnpm dev:scheduler  # Scheduler
```

---

## Catatan: Packages yang hilang dari zip ini

Beberapa packages diimport tapi tidak ada di zip ini:

| Package | Yang perlu dibuat |
|---------|-------------------|
| `@piggy/contracts` | Solidity contracts + foundry.toml |
| `@piggy/db` | Drizzle schema + query helpers |
| `@piggy/agent` | Transaction submitter + decision engine |
| `@piggy/config` | Chain config, token addresses, contract addresses |
| `@piggy/shared` | Types, constants, ABI, logger |
| `@piggy/adapters` | Aave, Mento, Uniswap read adapters |
| `@piggy/observability` | Agentscan event emitter |

Tanpa packages ini, services tidak bisa di-compile. Fork tetap bisa berjalan
dan ditest secara manual via `cast` atau `curl`.

---

## Useful cast commands

```bash
# Cek balance USDm
cast call 0x765DE816845861e75A25fCA122bb6898B8B1282a \
  "balanceOf(address)(uint256)" \
  0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
  --rpc-url http://localhost:8545

# Cek APY Aave (liquidity rate USDT)
cast call 0x3E59A31363BF5a55D8b31E5b7E59b7B3B14e32B7 \
  "getReserveData(address)((uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128))" \
  0x617f3112bf5397D0467D315cC709EF968D9ba546 \
  --rpc-url http://localhost:8545

# Mine 1 block manual
cast rpc anvil_mine 1 --rpc-url http://localhost:8545

# Reset fork ke block terbaru
cast rpc anvil_reset \
  '{"forking":{"jsonRpcUrl":"https://forno.celo.org"}}' \
  --rpc-url http://localhost:8545
```

---

## Test wallets (Anvil default)

| # | Address | Private Key |
|---|---------|-------------|
| 0 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` |
| 1 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` |

**⚠️ Jangan pernah gunakan private key ini di mainnet.**
