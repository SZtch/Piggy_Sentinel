import { SENTINEL_EXECUTOR_ABI } from "@piggy/shared";
import { logger } from "@piggy/shared";
import { MIN_REBALANCE_AMOUNT, MAX_REBALANCE_INTERVAL_MS, APY_CHANGE_THRESHOLD_PCT, MAX_ALLOCATION_SHIFT_BPS, MAX_GAS_TO_YIELD_RATIO_PCT, ALLOC_USDT_BPS, ALLOC_USDC_BPS, ALLOC_USDM_BPS, BLENDED_APY_PCT, } from "@piggy/shared";
import { getTokenAddress } from "@piggy/config/tokens";
import { CHAIN_ID } from "@piggy/config/chains";
import { encodeFunctionData, parseUnits } from "viem";
/** Normalise 6-decimal token (USDC/USDT) to 18 decimals for arithmetic */
function norm6to18(amount) {
    return amount * 10n ** 12n;
}
const BPS = 10000n;
const SLIPPAGE = parseUnits("0.99", 18);
/**
 * Compute optimal allocation based on current APYs.
 * Higher APY → higher allocation, within guardrail limits.
 * Max shift per rebalance: 20% (MAX_ALLOCATION_SHIFT_BPS).
 */
function computeOptimalAlloc(apys, currentBps) {
    const total = apys.usdt + apys.usdc + apys.usdm;
    const rawUsdt = Math.round((apys.usdt / total) * 10_000);
    const rawUsdc = Math.round((apys.usdc / total) * 10_000);
    const rawUsdm = 10_000 - rawUsdt - rawUsdc;
    // Clamp shift to MAX_ALLOCATION_SHIFT_BPS per rebalance
    const clamp = (current, target) => {
        const diff = target - current;
        if (Math.abs(diff) > MAX_ALLOCATION_SHIFT_BPS) {
            return current + Math.sign(diff) * MAX_ALLOCATION_SHIFT_BPS;
        }
        return target;
    };
    return {
        usdt: clamp(currentBps.usdt, rawUsdt),
        usdc: clamp(currentBps.usdc, rawUsdc),
        usdm: clamp(currentBps.usdm, rawUsdm),
    };
}
/**
 * Rebalance portfolio when APY shifts significantly.
 *
 * Guardrails (all must pass):
 *   1. Portfolio value >= MIN_REBALANCE_AMOUNT
 *   2. Not rebalanced in last 24h
 *   3. APY changed > 2% from current blended
 *   4. Gas cost < 10% of expected yield
 */
export async function rebalancePortfolio(input) {
    try {
        const { userWallet, executorAddress, currentApys, currentAllocations, totalPortfolioValue, lastRebalancedAt, estimatedGasCostUSD, } = input;
        const minAmount = parseUnits(MIN_REBALANCE_AMOUNT.toString(), 18);
        // ── Guardrail 1: minimum amount ───────────────────────────────
        if (totalPortfolioValue < minAmount) {
            return ok({ shouldRebalance: false, skipReason: "portfolio below minimum", newAllocBps: currentBps(), estimatedNewApy: BLENDED_APY_PCT, calldata: [] });
        }
        // ── Guardrail 2: frequency 24h ────────────────────────────────
        if (lastRebalancedAt) {
            const msSince = Date.now() - lastRebalancedAt.getTime();
            if (msSince < MAX_REBALANCE_INTERVAL_MS) {
                const hoursLeft = Math.ceil((MAX_REBALANCE_INTERVAL_MS - msSince) / 3_600_000);
                return ok({ shouldRebalance: false, skipReason: `rebalanced recently — wait ${hoursLeft}h`, newAllocBps: currentBps(), estimatedNewApy: BLENDED_APY_PCT, calldata: [] });
            }
        }
        // ── Guardrail 3: APY change threshold ─────────────────────────
        // Compute blended APY using portfolio proportions (not raw wei balances)
        // to avoid decimal mismatch (USDC/USDT = 6 dec vs USDm = 18 dec).
        const usdt18 = Number(norm6to18(currentAllocations.usdt));
        const usdc18 = Number(norm6to18(currentAllocations.usdc));
        const usdm18 = Number(currentAllocations.usdm);
        const aaveSum = usdt18 + usdc18 + usdm18 || 1; // prevent div-by-zero
        const blended = currentApys.usdt * (usdt18 / aaveSum) +
            currentApys.usdc * (usdc18 / aaveSum) +
            currentApys.usdm * (usdm18 / aaveSum);
        const apyDrift = Math.abs(blended - BLENDED_APY_PCT);
        if (apyDrift < APY_CHANGE_THRESHOLD_PCT) {
            return ok({ shouldRebalance: false, skipReason: `APY drift ${apyDrift.toFixed(2)}% below threshold`, newAllocBps: currentBps(), estimatedNewApy: blended, calldata: [] });
        }
        // ── Guardrail 4: gas cost ratio ───────────────────────────────
        const portfolioUSD = Number(totalPortfolioValue) / 1e18;
        const annualYieldUSD = portfolioUSD * (blended / 100);
        const dailyYieldUSD = annualYieldUSD / 365;
        const gasToYieldRatio = (estimatedGasCostUSD / dailyYieldUSD) * 100;
        if (gasToYieldRatio > MAX_GAS_TO_YIELD_RATIO_PCT) {
            return ok({ shouldRebalance: false, skipReason: `gas (${gasToYieldRatio.toFixed(1)}%) exceeds ${MAX_GAS_TO_YIELD_RATIO_PCT}% of daily yield`, newAllocBps: currentBps(), estimatedNewApy: blended, calldata: [] });
        }
        // ── All guardrails passed — compute new allocation ─────────────
        const newAlloc = computeOptimalAlloc(currentApys, currentBps());
        const newBlended = (currentApys.usdt * newAlloc.usdt +
            currentApys.usdc * newAlloc.usdc +
            currentApys.usdm * newAlloc.usdm) / 10_000;
        const usdmAddr = getTokenAddress(CHAIN_ID, "USDm");
        const usdtAddr = getTokenAddress(CHAIN_ID, "USDT");
        const usdcAddr = getTokenAddress(CHAIN_ID, "USDC");
        const executor = executorAddress;
        const user = userWallet;
        // ── Build calldata: withdraw from Aave, swap, re-supply ───────
        const calldata = [];
        // Step 1: call rebalance() gate on SentinelExecutor
        calldata.push({
            to: executor,
            data: encodeFunctionData({
                abi: SENTINEL_EXECUTOR_ABI,
                functionName: "rebalance",
                args: [user],
            }),
            value: 0n,
            description: "rebalance gate",
        });
        // Step 2: Agent withdraws from Aave back to userWallet using executeAaveWithdraw.
        // FIX (build-notes #3): was incorrectly using user-only withdraw() here, which
        // would always revert when submitted by the agent. executeAaveWithdraw() is the
        // correct agent-callable path for partial Aave exits during rebalancing.
        if (currentAllocations.usdt > 0n) {
            calldata.push({
                to: executor,
                data: encodeFunctionData({
                    abi: SENTINEL_EXECUTOR_ABI, functionName: "executeAaveWithdraw",
                    args: [user, usdtAddr, currentAllocations.usdt, 0n],
                }),
                value: 0n,
                description: "withdraw aUSDT from Aave",
            });
        }
        if (currentAllocations.usdc > 0n) {
            calldata.push({
                to: executor,
                data: encodeFunctionData({
                    abi: SENTINEL_EXECUTOR_ABI, functionName: "executeAaveWithdraw",
                    args: [user, usdcAddr, currentAllocations.usdc, 0n],
                }),
                value: 0n,
                description: "withdraw aUSDC from Aave",
            });
        }
        // Step 3: swap USDT back to USDm via Mento (stable swap)
        if (currentAllocations.usdt > 0n) {
            calldata.push({
                to: executor,
                data: encodeFunctionData({
                    abi: SENTINEL_EXECUTOR_ABI, functionName: "executeMentoSwap",
                    args: [user, usdtAddr, usdmAddr, currentAllocations.usdt,
                        (currentAllocations.usdt * SLIPPAGE) / parseUnits("1", 18)],
                }),
                value: 0n, // ERC-20 op — no native CELO
            });
        }
        // Step 4: re-allocate with new allocation ratios
        const newUsdtAmt = (totalPortfolioValue * BigInt(newAlloc.usdt)) / BPS;
        const newUsdcAmt = (totalPortfolioValue * BigInt(newAlloc.usdc)) / BPS;
        calldata.push({
            to: executor,
            data: encodeFunctionData({
                abi: SENTINEL_EXECUTOR_ABI, functionName: "executeMentoSwap",
                args: [user, usdmAddr, usdtAddr, newUsdtAmt,
                    (newUsdtAmt * SLIPPAGE) / parseUnits("1", 18)],
            }),
            value: 0n,
        });
        calldata.push({
            to: executor,
            data: encodeFunctionData({
                abi: SENTINEL_EXECUTOR_ABI, functionName: "executeMentoSwap",
                args: [user, usdmAddr, usdcAddr, newUsdcAmt,
                    (newUsdcAmt * SLIPPAGE) / parseUnits("1", 18)],
            }),
            value: 0n,
        });
        calldata.push({
            to: executor,
            data: encodeFunctionData({
                abi: SENTINEL_EXECUTOR_ABI, functionName: "executeAaveSupply",
                args: [user, usdtAddr, newUsdtAmt,
                    (newUsdtAmt * SLIPPAGE) / parseUnits("1", 18)],
            }),
            value: 0n,
        });
        calldata.push({
            to: executor,
            data: encodeFunctionData({
                abi: SENTINEL_EXECUTOR_ABI, functionName: "executeAaveSupply",
                args: [user, usdcAddr, newUsdcAmt,
                    (newUsdcAmt * SLIPPAGE) / parseUnits("1", 18)],
            }),
            value: 0n,
        });
        logger.info("rebalancePortfolio: rebalance required", {
            wallet: userWallet,
            apyDrift: apyDrift.toFixed(2),
            oldBlended: BLENDED_APY_PCT,
            newBlended: newBlended.toFixed(2),
            newAlloc,
        });
        return {
            success: true,
            data: {
                shouldRebalance: true,
                newAllocBps: newAlloc,
                estimatedNewApy: newBlended,
                calldata,
            },
            error: null,
            txHash: null,
            agentscanEventId: null,
            executedAt: new Date(),
        };
    }
    catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return { success: false, data: null, error, txHash: null, agentscanEventId: null, executedAt: new Date() };
    }
}
// helpers
function currentBps() {
    return { usdt: ALLOC_USDT_BPS, usdc: ALLOC_USDC_BPS, usdm: ALLOC_USDM_BPS };
}
function ok(data) {
    return { success: true, data, error: null, txHash: null, agentscanEventId: null, executedAt: new Date() };
}
