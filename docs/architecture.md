# Piggy Sentinel — Architecture (Post-Refactor)

## Overview

Single-contract, single-agent design. Non-custodial end-to-end.

**What "non-custodial" means here:**
No human — not the agent, not the owner, not Anthropic — can take user funds. All fund movements are governed exclusively by smart contract rules. Users can withdraw at any time directly from their wallet, with no permission required from anyone.

This is the same model used by Yearn Finance, Convex, and other DeFi vaults: the smart contract holds yield positions on behalf of users, but no individual has discretionary control over those funds.

---

## Architecture Flow

```
User Wallet (Privy EOA)
  │
  │  approve(SentinelExecutor, spendLimit)
  │  registerGoal(asset, amount, goalTarget, deadline, spendLimit)
  ▼
SentinelExecutor.sol  ◄──── Agent Wallet (single backend EOA)
  │                              calls: rebalance()
  │                                     executeAaveSupply()
  │                                     executeUniswapLP()
  │                                     checkAndExitLPIfIL()
  │                                     executeMentoSwap()
  │
  ├──► AaveAdapter   → Aave V3 Pool    → aTokens held by SentinelExecutor ✅
  ├──► UniswapAdapter → Uniswap V3 PM  → LP NFT held by UniswapAdapter ✅
  └──► MentoAdapter  → Mento Broker    → swapped tokens to userWallet ✅

Treasury Wallet
  └── receives performance fee (20% of yield) at goal completion
```

---

## Key Design Decisions

### 1. No AgentWallet per user
**Before:** Every user had their own `AgentWallet.sol` contract deployed.  
**After:** No per-user contracts. `SentinelExecutor` manages all users.

**Why:**
- Zero deployment cost for user onboarding
- User only needs 1 `approve()` call
- Simpler mental model

### 2. Single agentSigner EOA
One backend private key triggers all automation via `onlyAgent` modifier.

```solidity
modifier onlyAgent() {
    require(msg.sender == agentSigner, "not agent");
    _;
}
```

Key rotation uses a 48-hour timelock (`proposeAgentSigner` → `executeAgentSignerChange`).
Funds are safe because **funds never enter the agent wallet.**

### 3. Non-custodial by design

| Protocol | Where yield position is held | Who controls withdrawal |
|---|---|---|
| Aave | aTokens held by **SentinelExecutor** on behalf of user | User via `withdraw()` |
| Uniswap LP | NFT held by **UniswapAdapter** as escrow | User via `withdraw()` |
| Mento swap output | Sent directly to **userWallet** | User |
| Agent Wallet | Never holds funds, ever | — |

**Why positions are held by the contract (not user wallet):**

If aTokens were minted directly to the user wallet, the agent would need the user to approve every intermediate token (aUSDC, aUSDT, WETH) before each rebalance. That means multiple approval transactions per rebalance cycle — breaking the "set and forget" autonomy.

By holding positions in the contract, the agent can rebalance freely within the user's defined spend limit, using a single one-time approval. The user retains full exit rights at all times.

**Withdrawal is always available:**
- `withdraw()` can be called directly by the user at any time
- Works even when the contract is paused
- No permission required from agent or owner
- Funds cannot be frozen by any admin action

### 4. Asset Whitelist
Only 4 assets accepted:

| Asset | Use | Risk class |
|---|---|---|
| USDm | Input asset, gas (feeCurrency), Aave 10% | Stable |
| USDC | Aave yield 30%, Uniswap LP | Stable |
| USDT | Aave yield 60% | Stable |
| wETH | Uniswap LP (WETH/USDC, WETH/USDT) | Volatile |

**Swap routing:**
- Mento: USDm ↔ USDC, USDm ↔ USDT (stable-only)
- Uniswap: USDC ↔ WETH, USDT ↔ WETH (any volatile swap)
- Mento is **never** used for WETH swaps

Any asset not in whitelist → tx reverts.

---

## Guardrails

All enforced on-chain in `SentinelExecutor`:

| Guardrail | Value | Where enforced |
|---|---|---|
| Max LP allocation | 30% of portfolio | `executeUniswapLP()` |
| Max volatile allocation | 40% of portfolio | `executeUniswapLP()` |
| IL stop loss | Exit if IL > 5% | `checkAndExitLPIfIL()` |
| Max rebalance frequency | Once per 24h | `rebalance()` |
| Max slippage | 1% | `executeAaveSupply()`, `executeMentoSwap()` |
| Spend limit | User-defined at deposit | `_checkAndUpdateSpend()` |
| Epoch duration | Min 30 days between resets | `resetSpendEpoch()` |

---

## Strategy Allocation by Risk Profile

| Profile | Aave (USDC/USDT/USDm) | Uniswap LP | WETH hold |
|---|---|---|---|
| Conservative | 100% | 0% | 0% |
| Moderate | 70% | 20% | 10% |
| Aggressive | 40% | 30% | 30% |

Penny (the AI agent) recommends a profile based on:
- Goal timeline (shorter → more conservative)
- User's stated risk tolerance
- Current APY environment

---

## Withdraw Flow

User can withdraw anytime. No lock-up.

```
User calls withdraw()
  │
  ├── Exit Aave positions (proportional live balance including yield)
  │     aaveAdapter.withdraw() → tokens land in SentinelExecutor
  │
  ├── Exit all LP positions
  │     uniswapAdapter.exitPosition() → tokens to userWallet
  │
  ├── Calculate yield = totalWithdrawn - principal
  │
  ├── Performance fee = yield × 20%
  │     transfer(treasury, fee)
  │
  ├── Swap remaining USDC/USDT → USDm via Mento
  │
  └── Transfer USDm to userWallet
      Emit GoalCompleted(user, totalReturned, feeTaken)
```

**Principal is never touched.** Fee only on yield.

---

## Security Considerations

| Risk | Mitigation |
|---|---|
| Agent key compromised | 48h timelock on key rotation. Funds safe — agent never holds funds. |
| Malicious rebalance | Guardrails on-chain, cannot be bypassed by agent |
| User approval too high | spendLimit enforced per-epoch in contract, min 30-day reset |
| Protocol hack (Aave/Uniswap) | Diversification across protocols; user can pause anytime |
| IL loss | 5% stop-loss exits LP automatically |
| Slippage / MEV sandwich | 1% min slippage on all swaps and LP entry |
| Multi-user fund mixing | Per-user parkedFunds escrow — no cross-user contamination |
| Owner key compromised | Transfer ownership to Gnosis Safe before mainnet |

---

## What Was Removed

| Item | Reason |
|---|---|
| `AgentWallet.sol` | Replaced by direct SentinelExecutor management |
| `registerWallet()` | Not needed — no per-user wallet registry |
| `deregisterWallet()` | Not needed |
| `registeredWallets mapping` | Not needed |
| FX hedge (EURm) | V2 — out of scope for MVP |

---

## What Was Added

| Item | Purpose |
|---|---|
| `address public agentSigner` | Single backend EOA for automation |
| `modifier onlyAgent()` | Protects all automation functions |
| `proposeAgentSigner` + timelock | Safe key rotation with 48h delay |
| `UniswapAdapter.sol` | Uniswap V3 LP position management |
| Asset whitelist mapping | Enforces 4-asset-only policy |
| LP guardrails | 30% cap + IL stop-loss |
| Volatile allocation cap | 40% max in wETH |
| Risk profiles | Conservative/Moderate/Aggressive presets |
| `LPPosition` struct | Tracks LP for IL monitoring |
| `parkedFunds` mapping | Per-user escrow during LP sequences |
| `totalATokenShares` mapping | Proportional yield distribution on withdraw |
| `withdraw()` with fee | Performance fee deducted at completion |
