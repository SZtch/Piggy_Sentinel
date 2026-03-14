# Piggy Sentinel — Architecture (Post-Refactor)

## Overview

Single-contract, single-agent design. Non-custodial end-to-end.

---

## Architecture Flow

```
User Wallet (Privy EOA)
  │
  │  approve(SentinelExecutor, spendLimit)
  │  deposit(asset, amount, goalTarget, deadline, spendLimit)
  ▼
SentinelExecutor.sol  ◄──── Agent Wallet (single backend EOA)
  │                              calls: rebalance()
  │                                     executeAaveSupply()
  │                                     executeUniswapLP()
  │                                     checkAndExitLPIfIL()
  │                                     executeMentoSwap()
  │                                     withdraw()
  ├──► AaveAdapter   → Aave V3 Pool    → aTokens back to userWallet ✅
  ├──► UniswapAdapter → Uniswap V4 PM  → LP NFT back to userWallet ✅
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

If the key is compromised → `setAgentSigner()` rotates it immediately.  
Funds are safe because **funds never enter the agent wallet.**

### 3. Non-custodial by design
| Protocol | Where funds go |
|---|---|
| Aave | aTokens minted to **userWallet** |
| Uniswap LP | NFT minted to **userWallet** |
| wETH (hold) | Held in **userWallet** |
| SentinelExecutor | Never holds funds at rest |
| Agent Wallet | Never holds funds, ever |

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
User or Agent calls withdraw()
  │
  ├── Exit Aave positions
  │     aaveAdapter.withdraw() → tokens to userWallet
  │
  ├── Exit all LP positions  
  │     uniswapAdapter.exitPosition() → tokens to userWallet
  │
  ├── Calculate yield = totalWithdrawn - principalDeposited
  │
  ├── Performance fee = yield × 20%
  │     transferFrom(userWallet, treasury, fee)
  │
  └── Emit GoalCompleted(user, totalReturned, feeTaken)
```

**Principal is never touched.** Fee only on yield.

---

## Security Considerations

| Risk | Mitigation |
|---|---|
| Agent key compromised | `setAgentSigner()` rotates key. Funds safe — agent never holds funds. |
| Malicious rebalance | Guardrails on-chain, cannot be bypassed by agent |
| User approval too high | spendLimit enforced per-epoch in contract |
| Protocol hack (Aave/Uniswap) | Diversification across protocols; user can pause anytime |
| IL loss | 5% stop-loss exits LP automatically |
| Slippage attack | 1% max slippage reverts suspicious swaps |

---

## What Was Removed

| Item | Reason |
|---|---|
| `AgentWallet.sol` | Replaced by direct SentinelExecutor management |
| `registerWallet()` | Not needed — no per-user wallet registry |
| `deregisterWallet()` | Not needed |
| `registeredWallets mapping` | Not needed |
| FX hedge (EURm) | V2 — out of scope for MVP |
| observability package | Incorrect use of agentscan API |
| opclaw.ts HTTP client | Incorrect OpenClaw integration pattern |

---

## What Was Added

| Item | Purpose |
|---|---|
| `address public agentSigner` | Single backend EOA for automation |
| `modifier onlyAgent()` | Protects all automation functions |
| `UniswapAdapter.sol` | Uniswap V4 LP position management |
| Asset whitelist mapping | Enforces 4-asset-only policy |
| LP guardrails | 30% cap + IL stop-loss |
| Volatile allocation cap | 40% max in wETH |
| Risk profiles | Conservative/Moderate/Aggressive presets |
| `LPPosition` struct | Tracks LP for IL monitoring |
| `withdraw()` with fee | Performance fee deducted at completion |
