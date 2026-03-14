# Piggy Sentinel — Build Notes

## Day 1 Checklist

### 1. Verify token addresses on Celo Sepolia

Check both candidates for USDm and EURm at https://celo-sepolia.blockscout.com.
Use whichever shows the correct token symbol and has recent transfer activity.

| Token | Candidate A | Candidate B | Status |
|-------|-------------|-------------|--------|
| USDm  | 0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b | 0xEF4d55D6dE8e8d73232827Cd1e9b2F2dBb45bC80 | ❌ Verify |
| EURm  | 0xA99dC247d6b7B2E3ab48a1fEE101b83cD6aCd82a | 0x6B172e333e2978484261D7eCC3DE491E79764BbC | ❌ Verify |

### 2. Find Aave V3 and Mento Broker on Celo Sepolia

Both addresses must be set in `.env` before adapters will work:

```
AAVE_POOL_ADDRESS_SEPOLIA=
MENTO_BROKER_ADDRESS_SEPOLIA=
```

Check:
- Aave V3: https://docs.aave.com/developers/deployed-contracts/v3-testnet-addresses
- Mento: https://docs.mento.org/mento/developers/deployments

### 3. Deploy contracts

```bash
# Set env vars first
export CELO_RPC_URL_SEPOLIA=https://forno.celo-sepolia.celo.org
export AAVE_POOL_ADDRESS_SEPOLIA=<verified address>
export MENTO_BROKER_ADDRESS_SEPOLIA=<verified address>

pnpm contracts:deploy:sepolia
# Paste output addresses into .env
```

### 4. Fund relayer wallet

The relayer pays gas for all agent transactions. It holds no user funds.

```bash
# Get Sepolia CELO faucet:
#   https://faucet.celo.org/celo-sepolia
#   https://cloud.google.com/application/web3/faucet/celo/sepolia
# Fund ~5 CELO to RELAYER_PRIVATE_KEY address
```

## Known Gaps (fix before first end-to-end flow)

1. ~~`apps/web/src/app/onboarding/page.tsx` — AgentWallet deploy button is a guide stub.~~
   ~~In production, use a factory contract. For hackathon: deploy via forge and paste address.~~
   > **TODO**: Wire to factory contract or onboarding state after deploying.

2. ~~`apps/web/src/app/goals/new/page.tsx` — `agentWallet` field requires manual entry.~~
   ~~Wire to factory or onboarding state after deploying AgentWallet.~~
   > **TODO**: Wire to factory or onboarding state.

3. ~~`services/scheduler/src/jobs/runGoalCycle.ts` — withdrawal calldata uses `allocateSavings`.~~
   ~~The withdraw path should use `executeAaveWithdraw` instead. Update for production.~~
   > **FIXED**: Added `executeAaveWithdraw` to SentinelExecutor.sol and updated
   > `rebalancePortfolio.ts` to use it. The user-only `withdraw()` is no longer
   > called from agent-submitted calldata.

4. `packages/skills/src/checkFxDrift.ts` — x402 integration is a stub.
   Set `USE_X402_FOR_FX=true` and implement when x402 is confirmed on testnet.

## Bug Fixes Applied (piggy-sentinel-fixed)

| # | Bug | File | Fix |
|---|-----|------|-----|
| 1 | Chain ID `44787` (Alfajores) → should be `11142220` (Celo Sepolia) | `config/contracts.ts`, `config/tokens.ts` | Renamed keys to `11142220`; removed duplicate Alfajores entry |
| 2 | `SupportedChainId` exported as `44787\|42220` from contracts/tokens, but `11142220\|42220` from chains | `config/contracts.ts`, `config/tokens.ts` | Aligned to `11142220\|42220` across all config files |
| 3 | `TIER_ALLOC[tier]` reference mutated directly (LP cap clamp corrupted global state) | `packages/agent/src/decisionEngine.ts` | Spread copy: `const targetAlloc = { ...TIER_ALLOC[tier] }` |
| 4 | IL check called with hardcoded empty arrays — LP stop-loss never fired | `services/scheduler/src/jobs/runGoalCycle.ts` | `loadPortfolio` now reads LP positions from contract; passed to `checkIL` |
| 5 | aToken fallback used underlying token address — double-counted wallet balances as Aave positions | `services/scheduler/src/jobs/runGoalCycle.ts` | Fallback changed to zero address with explicit warning log |
| 6 | Slippage check in `executeMentoSwap` compared `amountOut < amountIn` (wrong baseline) | `packages/contracts/src/SentinelExecutor.sol` | Changed to `amountOut < minAmountOut` (caller-supplied floor) |
| 7 | Performance fee always charged from `aaveAssets[0]` regardless of balance | `packages/contracts/src/SentinelExecutor.sol` | Fee now distributed proportionally across all available asset balances |
| 8 | `rebalancePortfolio` used user-only `withdraw()` in agent calldata — always reverts | `packages/skills/src/rebalancePortfolio.ts`, `SentinelExecutor.sol`, ABI | Added `executeAaveWithdraw` agent function; updated skill + ABI |
| 9 | `lpPositions` view not in ABI — agent cycle couldn't read LP state | `packages/shared/src/abis/index.ts` | Added `lpPositions(address, uint256)` view to ABI |

## Mainnet Protocol Addresses (verify before prod deploy)

| Protocol | Address | Source |
|----------|---------|--------|
| USDm     | 0x765DE816845861e75A25fCA122bb6898B8B1282a | Celo Docs (confirmed) |
| EURm     | 0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73 | Celo Docs (confirmed) |
| Aave V3 Pool | 0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402 | Verify at docs.aave.com |
| Mento Broker | 0x777A8255cA72412f0d706dc03C9D1987306B4CaD | Verify at docs.mento.org |
