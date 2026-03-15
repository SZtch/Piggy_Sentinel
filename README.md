# 🐷 PiggySentinel

Most people have money sitting in a wallet doing absolutely nothing. Not because they don't care — because managing it is annoying. You have to research protocols, monitor rates, rebalance positions, worry about rug pulls, and somehow remember to do all of this while living your actual life. So the money just sits there.

We built Penny to fix that.

Penny is an autonomous savings agent on Celo. You give her a goal — "I want $2,000 for Japan by October" or "emergency fund, $3,000, six months" — a deadline, and a monthly budget she's allowed to work with. She handles the rest. She moves your stablecoins into yield positions on Aave, monitors them, rebalances when something better comes along, and steps aside when you're done.

The important part: **your money never leaves your wallet.** Penny operates through an on-chain allowance you set. She can only move what you gave her permission to move, only within the monthly limit you defined. You can pause her, take back control, or withdraw everything at any second. No waiting. No asking anyone.

## Real goals, not yield strategies

- *"I want $2,000 saved for Japan by October"* — Penny allocates, monitors, and tells you when you're on track
- *"Emergency fund — $3,000 in 6 months, I keep forgetting"* — set it once, Penny handles it quietly
- *"New laptop, $800, I'm tired of waiting"* — she'll get you there while your money earns yield
- *"I have idle USDC and I'm tired of watching it do nothing"* — Penny puts it to work immediately

These are goals. Not yield strategies. Penny manages them end to end.

## How it works

1. **Set a goal** — name it, set a target amount, a deadline, and a monthly budget for Penny
2. **Penny allocates into Aave V3 on Celo** — earning yield automatically across USDC, USDT, and USDm
3. **She monitors, rebalances, and protects** — pauses herself if something looks wrong
4. **Goal reached** — she returns everything. You withdraw directly from your wallet.

## Your money, your wallet

This needs to be crystal clear:

- Funds never leave your wallet until Penny moves them into yield — and even then, she's operating within the allowance *you* set
- Penny operates via on-chain allowance — not ownership. She never holds your money.
- Withdraw anytime. No permission from anyone. No waiting period. Just do it.
- If our backend goes offline tomorrow — your funds are still safe, still withdrawable, directly on-chain

## Security as a design philosophy

We didn't bolt security on after building. Every decision started with "what's the worst thing that could happen?"

**Spend limit per epoch.** Penny can only move up to what you defined, per 30-day window. Even if the agent key gets compromised — worst case drain is one month's budget. Not your life savings. One month.

**48-hour timelock on agent key rotation.** The old key still works during transition. No sudden lockouts. No surprise key swaps.

**Circuit breaker.** Penny pauses herself when she detects risk — stablecoin depeg, volatility spike, protocol issues. She handles it before you even know something happened. You still withdraw freely.

**Performance fee: 20% of yield only.** Principal is never touched. Ever. Under any circumstances.

**Every action on-chain and auditable.** Check Celoscan. It's all there.

## Stack

| Layer | Tech |
|---|---|
| Chain | Celo Mainnet |
| Contracts | Solidity 0.8.24 + Foundry |
| Yield | Aave V3 (USDC, USDT, USDm) |
| Stable routing | Mento (USDm ↔ USDC, USDm ↔ USDT) |
| Swaps + LP | Uniswap V4 |
| Auth / Wallets | Privy embedded wallets |
| Agent runtime | OpenClaw |
| Observability | agentscan |
| Micropayments | x402 |
| Backend | Fastify + BullMQ + postgres.js |
| Web | Next.js 14 |
| Bot | Telegram (Grammy) |

## Monorepo

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
│   └── web/          Next.js dashboard
└── docs/
```

## Quick start

```bash
# Prerequisites: Node 20+, pnpm 9+, Foundry, Postgres, Redis
pnpm install
cp .env.example .env
# Fill in AGENT_SIGNER_PRIVATE_KEY, AGENT_SIGNER_ADDRESS, DATABASE_URL, REDIS_URL at minimum
pnpm db:migrate
pnpm contracts:build

# Unit tests (59 tests)
forge test --match-path test/SentinelExecutor.t.sol -vv

# Fork tests against live Celo Mainnet (15 tests)
forge test --match-path test/ForkFullFlow.t.sol --fork-url https://forno.celo.org -vvv

# Start services
pnpm dev:api        # terminal 1
pnpm dev:scheduler  # terminal 2
pnpm dev:web        # terminal 3
```

## Docs

- [docs/architecture.md](./docs/architecture.md) — how it's built and why
- [docs/build-notes.md](./docs/build-notes.md) — known gaps and fixes applied
- [docs/deploy.md](./docs/deploy.md) — mainnet deployment guide

## License

MIT
