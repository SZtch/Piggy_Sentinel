# 🐷 Piggy Sentinel

Non-custodial autonomous savings agent on Celo.

Set a savings goal. Penny (the AI agent) allocates to Aave, monitors progress,
rebalances automatically, and returns funds when the goal is complete —
all within bounds you approve on-chain. User funds never leave the user wallet.

## Stack

| Layer | Tech |
|---|---|
| Chain | Celo (Sepolia testnet → Mainnet) |
| Contracts | Solidity 0.8.24 + Foundry |
| Yield | Aave V3 (USDC, USDT, USDm) |
| Stable routing | Mento (USDm ↔ USDC, USDm ↔ USDT) |
| LP + volatile swaps | Uniswap V4 (WETH/USDC, WETH/USDT) |
| Auth / Wallets | Privy embedded wallets |
| Agent orchestration | Single agentSigner EOA + SentinelExecutor |
| Agent observability | agentscan |
| Agent reasoning | OpenClaw |
| Micropayments | x402 |
| Backend | Fastify + BullMQ + postgres.js |
| Web | Next.js 14 + Privy |
| Bot | Telegram (Grammy) |

## Monorepo layout

```
piggy-sentinel/
├── config/           chains, tokens, protocols
├── packages/
│   ├── shared/       types, constants, ABIs, utils
│   ├── contracts/    Solidity + Foundry
│   ├── adapters/     off-chain Aave + Mento readers
│   ├── skills/       agent skill modules
│   ├── agent/        runner, OpenClaw client, decision engine
│   ├── db/           postgres client + schema + migrations
│   └── observability/ agentscan emitter
├── services/
│   ├── api/          Fastify HTTP API
│   └── scheduler/    BullMQ cron workers
├── apps/
│   ├── web/          Next.js dashboard
│   └── web/          Next.js dashboard
└── docs/
```

## Quick start

```bash
# 1. Prerequisites: Node 20+, pnpm 9+, Foundry, Postgres, Redis

# 2. Install
pnpm install

# 3. Configure
cp .env.example .env
# Fill in RELAYER_PRIVATE_KEY, DATABASE_URL, REDIS_URL at minimum

# 4. Database
pnpm db:migrate

# 5. Contracts
pnpm contracts:build
pnpm contracts:test

# 6. Services (separate terminals)
pnpm dev:api
pnpm dev:scheduler
pnpm dev:notifier
pnpm dev:web
```

## Environment modes

| APP_ENV | Chain | Chain ID |
|---|---|---|
| dev | Celo Sepolia | 11142220 |
| staging | Celo Sepolia | 11142220 |
| prod | Celo Mainnet | 42220 |

Mainnet transactions are blocked unless `ENABLE_MAINNET_EXECUTION=true` and `NODE_ENV=production`.

## Docs

- [Build Notes](./docs/build-notes.md)
- [Contract Deploy](./docs/deploy.md)
