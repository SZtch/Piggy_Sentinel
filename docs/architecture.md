# PiggySentinel — Architecture

## The problem this architecture solves

The hard part of a savings agent isn't the yield — it's staying non-custodial while being autonomous enough to actually work. If aTokens went straight to user wallets, every rebalance would need a new approval. That breaks the "set it and forget it" promise. SentinelExecutor holds positions on behalf of users, so Penny can rebalance freely within the budget the user defined. Users keep full exit rights at all times.

No human — not the agent, not the owner, not anyone — can take user funds. All fund movements are governed exclusively by smart contract rules.

---

## Architecture flow

```
User Wallet (Privy EOA)
  │  approve(SentinelExecutor, spendLimit)
  │  registerGoal(asset, amount, goalTarget, deadline, spendLimit)
  ▼
SentinelExecutor.sol ◄──── agentSigner EOA (backend server)
  │                              executeAaveSupply()
  │                              executeAaveWithdraw()
  │                              rebalance()
  │                              resetSpendEpoch()
  │                              executeMentoSwap()
  │                              executeUniswapSwap()
  │                              executeAddLiquidity()
  │
  ├──► AaveAdapter    → Aave V3 Pool  → aTokens held by SentinelExecutor
  ├──► MentoAdapter   → Mento Broker  → stable swaps
  └──► UniswapAdapter → Uniswap V4    → volatile swaps / LP NFTs

Treasury Wallet ← 20% of yield at goal completion
```

---

## Key design decisions

### 1. No per-user AgentWallet contract

**Before:** Every user deployed their own `AgentWallet.sol`. Each deployment cost gas, added onboarding friction, and made the system harder to reason about.

**After:** `SentinelExecutor` manages all users directly. One contract, one `approve()` call per user.

**Why:** Zero deployment cost for onboarding. Simpler mental model for both users and developers. One contract to audit instead of N.

### 2. Single agentSigner EOA

One backend key triggers all automation via the `onlyAgent` modifier. Key rotation uses a 48-hour timelock — `proposeAgentSigner()` starts the clock, `executeAgentSignerChange()` finalizes it. The old key stays valid during the transition window.

Funds never enter the agent wallet. If the key is compromised, the worst case is the agent can drain up to 1× `spendLimit` before the epoch resets. Not great. Not catastrophic.

### 3. Spend limit as the trust boundary

The user sets `spendLimit` at `registerGoal()` — this is the maximum Penny can move per 30-day epoch. Stored normalized to 18 decimals internally via `_normalizeTo18()` so USDC (6 decimals) and USDm (18 decimals) compare consistently.

Agent spending is tracked via `cumulativeSpent`. Resets only after a 30-day minimum epoch. This prevents drain-reset-drain attacks — the agent can't call `resetSpendEpoch()` back-to-back to bypass the limit.

### 4. Per-user aToken shares (not balances)

`userATokenShares[user][asset]` tracks each user's proportion of the total aToken pool.

On withdraw: `liveUserAmount = (livePool × userShares) / totalShares`

This captures yield automatically as aTokens rebase — no manual yield accounting needed. Users are completely isolated. No cross-user drain is possible.

### 5. Parked funds per user

Funds between `executeAaveWithdraw()` and the next operation sit in `parkedFunds[user][asset]` — a per-user slot. Never mixed across users. This prevents any cross-contamination during multi-step operations.

---

## Guardrails

All enforced on-chain in `SentinelExecutor`. The agent cannot bypass these.

| Guardrail | Value | Enforcement |
|---|---|---|
| Max LP allocation | 30% of portfolio | `executeUniswapLP()` |
| Max volatile (WETH) | 40% of portfolio | `executeUniswapLP()` |
| IL stop-loss | Exit LP if IL > 5% | `checkAndExitLPIfIL()` |
| Max rebalance frequency | Once per 24h per user | `rebalance()` |
| Slippage protection | 1% min on all swaps | `executeAaveSupply()`, `executeMentoSwap()` |
| Spend limit | User-defined, per 30-day epoch | `_checkAndUpdateSpend()` |
| Agent key rotation | 48h timelock | `proposeAgentSigner()` |

---

## Strategy allocation by risk profile

| Profile | Aave (USDC/USDT/USDm) | Uniswap LP | WETH |
|---|---|---|---|
| Conservative | 100% | 0% | 0% |
| Moderate | 70% | 20% | 10% |
| Aggressive | 40% | 30% | 30% |

Penny recommends a profile based on goal timeline (shorter = more conservative), stated risk tolerance, and current APY environment.

---

## Asset whitelist

Only 4 assets accepted. Anything else reverts.

| Asset | Use | Risk class |
|---|---|---|
| USDm | Input asset, Aave 10% | Stable |
| USDC | Aave 30%, Uniswap LP | Stable |
| USDT | Aave 60% | Stable |
| WETH | Uniswap LP only | Volatile |

**Swap routing:**

- **Mento:** USDm ↔ USDC, USDm ↔ USDT (stable only — Mento is never used for WETH)
- **Uniswap:** USDC/USDT ↔ WETH (volatile only)

---

## Withdraw flow

User calls `withdraw()` — available anytime, even when contract is paused.

```
User calls withdraw()
  ├── Exit Aave: proportional live balance (principal + yield)
  ├── Exit LP positions via UniswapAdapter
  ├── Calculate yield = totalWithdrawn - principalDeposited
  ├── Performance fee = yield × 20% → treasury
  ├── Swap remaining USDC/USDT → USDm via Mento
  └── Transfer USDm to userWallet + emit GoalCompleted
```

Principal is never touched. Fee only on yield, distributed proportionally across available asset balances.

---

## Security properties

| Risk | Mitigation |
|---|---|
| Agent key compromised | 48h timelock on rotation. Max drain = 1× monthly budget. Funds never enter agent wallet. |
| Malicious rebalance | On-chain guardrails — not bypassable by agent |
| Cross-user drain | Per-user aToken shares + per-user parkedFunds — complete isolation |
| Owner key compromised | `transferOwnership()` — rotate to multisig before mainnet |
| Protocol pause | User `withdraw()` still works when contract is paused |
| Decimal inconsistency | `setAssetDecimals()` required before `setWhitelistedAsset()` |
| Slippage / MEV sandwich | 1% minimum slippage on all swaps and LP entry |

---

## Backend services

| Service | Role |
|---|---|
| `scheduler` | BullMQ cron — agent cycle, goal evaluation, tx submission |
| `api` | Fastify HTTP — goal CRUD, agent events, Telegram linking |
| `agent` | OpenClaw runner — SOUL.md + AGENTS.md, Telegram communication |
| `notifier` | Proactive Telegram alerts — goal reached, circuit breaker, rebalance |

---

## Contracts

| Contract | Purpose |
|---|---|
| `SentinelExecutor.sol` | Core — all user and agent interactions |
| `AaveAdapter.sol` | Aave V3 supply/withdraw |
| `MentoAdapter.sol` | Mento stable swap |
| `UniswapAdapter.sol` | Uniswap V4 swap + LP management |
| `AaveOracleWrapper.sol` | Adapts Aave oracle to `IPriceOracle` interface |
