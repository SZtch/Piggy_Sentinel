# Deployment Guide

## Celo Sepolia (development / staging)

```bash
# 1. Copy and fill env
cp .env.example .env
# Set: CELO_RPC_URL_SEPOLIA, AAVE_POOL_ADDRESS_SEPOLIA, MENTO_BROKER_ADDRESS_SEPOLIA
# Set: RELAYER_PRIVATE_KEY

# 2. Install and build
pnpm install
pnpm build

# 3. Migrate DB
pnpm db:migrate

# 4. Deploy contracts
pnpm contracts:deploy:sepolia
# Paste output into .env:
# SENTINEL_EXECUTOR_ADDRESS=
# AAVE_ADAPTER_ADDRESS=
# MENTO_ADAPTER_ADDRESS=
# NEXT_PUBLIC_SENTINEL_EXECUTOR_ADDRESS=

# 5. Run smoke test
pnpm smoke-test

# 6. Start services
pnpm dev:api
pnpm dev:scheduler
pnpm dev:bot
pnpm dev:web
```

## Celo Mainnet (production)

```bash
# Only after Sepolia smoke tests pass.

# 1. Create .env.prod (gitignored)
APP_ENV=prod
NODE_ENV=production
ENABLE_MAINNET_EXECUTION=true
CELO_RPC_URL_MAINNET=<alchemy-or-infura-url>
RELAYER_PRIVATE_KEY=<mainnet-relayer-key>
# ... all other vars

# 2. Deploy contracts to mainnet
pnpm contracts:deploy:mainnet

# 3. Update .env.prod with mainnet contract addresses

# 4. Start with prod env
NODE_ENV=production APP_ENV=prod node dist/index.js
```

## Switching environments

No code changes required. Only swap `.env` values:

| Variable | Sepolia | Mainnet |
|---|---|---|
| APP_ENV | dev / staging | prod |
| ENABLE_MAINNET_EXECUTION | false | true |
| NODE_ENV | development | production |
| SENTINEL_EXECUTOR_ADDRESS | sepolia address | mainnet address |
