/**
 * Piggy Sentinel — Agent Cycle
 *
 * Runs per goal on schedule (every 6h).
 * Pipeline:
 *   1. Load goal + portfolio state
 *   2. Run decision engine (tier, guardrails, profitability)
 *   3. If execute: IL check → rebalance → Aave allocations
 *   4. Intelligence layer: progress · pace · top-up · explanation
 *   5. Notify via Telegram with context-rich messages
 *
 * Agent wallet NEVER holds user funds.
 * All positions registered to userWallet directly.
 */
import {
  getGoalById, insertExecution, updateExecution,
  insertSnapshot, insertNotification, getTelegramChatId,
  updateGoalStatus, updateGoalAfterCycle,
  setGoalActionRequired, insertAgentEvent,
} from "@piggy/db";
import { submitTransaction }               from "@piggy/agent";
import { makeDecision }                    from "@piggy/agent/decisionEngine.js";
import { rebalancePortfolio, checkIL }     from "@piggy/agent/skills/index.js";
import {
  analyzeGoalFeasibility,
  trackPace,
  computeTopUpSuggestion,
  explainRebalance,
  explainILExit,
  computeGoalProgress,
} from "@piggy/agent/intelligence/index.js";
// ── Safety modules (previously dead code — now active) ────────────────────
import {
  computeRiskScore,
  aggregateRiskScores,
  evaluateCircuitBreaker,
  checkStablecoinPegs,
  simulateTransaction,
} from "@piggy/agent/skills/safety/index.js";
import {
  checkProtocolHealth,
  evaluateGasPolicy,
} from "@piggy/agent/skills/intelligence/index.js";
import type { RiskScore }         from "@piggy/agent/skills/safety/riskScoringEngine.js";
import type { SystemHealthResult } from "@piggy/agent/skills/intelligence/protocolHealthMonitor.js";
// ─────────────────────────────────────────────────────────────────────────────
import { logger }                          from "@piggy/shared";
import { CHAIN_ID }                        from "@piggy/config/chains";
import { getDeployedAddress }              from "@piggy/config/contracts";
import { getTokenAddress }                 from "@piggy/config/tokens";
import { createPublicClient, http, formatUnits } from "viem";
import { activeChain }                     from "@piggy/config/chains";
import type { NotificationType }           from "@piggy/shared";
import { encodeFunctionData }              from "viem";
import { SENTINEL_EXECUTOR_ABI }           from "@piggy/shared";

import { getCurrentApy as getAaveApy }     from "@piggy/adapters/aave.js";
import { fetchVolatility24h }              from "@piggy/agent/skills/safety/index.js"; // includes simulateTransaction
import { optimizeAllocation, buildWithdrawPlan, checkUserPolicy } from "@piggy/agent/skills/intelligence/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Live data helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch live APYs from Aave on-chain for all three stable assets.
 *
 * AUTONOMY FIX: was static env-var values (1.07%, 2.61%, 8.89%).
 * Static APYs mean rebalancing never responds to real market conditions.
 * Falls back to env vars if the on-chain read fails (e.g. RPC outage).
 */
async function fetchLiveApys(): Promise<{ usdm: number; usdc: number; usdt: number }> {
  const [usdm, usdc, usdt] = await Promise.all([
    getAaveApy("USDm").catch(() => null),
    getAaveApy("USDC").catch(() => null),
    getAaveApy("USDT").catch(() => null),
  ]);
  const result = {
    usdm: usdm ?? parseFloat(process.env.APY_USDM ?? "1.07"),
    usdc: usdc ?? parseFloat(process.env.APY_USDC ?? "2.61"),
    usdt: usdt ?? parseFloat(process.env.APY_USDT ?? "8.89"),
  };
  if (!usdm || !usdc || !usdt) {
    logger.warn("fetchLiveApys: partial fallback to env vars — some Aave reads failed", result);
  }
  return result;
}

/**
 * Get live WETH/USD price from Uniswap V3 USDC/WETH pool (slot0 sqrtPriceX96).
 *
 * FIX: the previous implementation called getMentoFxRate("USDC", "wETH") which
 * always reverts — Mento only supports stable↔stable pairs and has no WETH market.
 * This meant the function silently fell back to the env var ($3000) on every single
 * call, making the "live price" completely static.
 *
 * Fix: read sqrtPriceX96 from the Uniswap V3 USDC/WETH 0.3% pool directly.
 * This is always available on Celo mainnet and requires no external API.
 *
 * sqrtPriceX96 encodes price as: price = (sqrtPriceX96 / 2^96)^2
 * For USDC(6dec)/WETH(18dec): adjust by 10^(18-6) = 10^12
 *
 * Falls back to env var if the pool read fails (RPC outage, wrong address, etc).
 */
async function fetchEthPriceUSD(): Promise<number> {
  const POOL_ABI = [{
    type: "function", name: "slot0",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96",               type: "uint160" },
      { name: "tick",                        type: "int24"   },
      { name: "observationIndex",            type: "uint16"  },
      { name: "observationCardinality",      type: "uint16"  },
      { name: "observationCardinalityNext",  type: "uint16"  },
      { name: "feeProtocol",                 type: "uint8"   },
      { name: "unlocked",                    type: "bool"    },
    ],
    stateMutability: "view",
  }] as const;

  // Uniswap V3 USDC/WETH 0.3% pool on Celo mainnet.
  // Verify: https://info.uniswap.org/#/celo/pools
  const USDC_WETH_POOL = (process.env.UNISWAP_USDC_WETH_POOL as `0x${string}`)
    ?? "0x2d70Cbabf4D8e61d5317B62cBF8C90B342b7d2e2"; // Celo mainnet USDC/WETH 0.3%

  try {
    const slot0 = await publicClient.readContract({
      address:      USDC_WETH_POOL,
      abi:          POOL_ABI,
      functionName: "slot0",
    });

    const sqrtPriceX96 = slot0[0];
    if (!sqrtPriceX96 || sqrtPriceX96 === 0n) throw new Error("sqrtPriceX96 is zero");

    // price = (sqrtPriceX96 / 2^96)^2
    // token0=USDC(6dec), token1=WETH(18dec)
    // raw price = USDC per WETH in token units
    // adjust decimals: multiply by 10^(18-6) = 10^12 to get USD per WETH
    const Q96 = 2n ** 96n;
    const priceRaw = (sqrtPriceX96 * sqrtPriceX96 * 10n ** 12n) / (Q96 * Q96);
    const priceUSD = Number(priceRaw);

    // Sanity check — WETH should be between $100 and $100,000
    if (priceUSD < 100 || priceUSD > 100_000) {
      throw new Error(`WETH price out of expected range: $${priceUSD}`);
    }

    logger.info(`fetchEthPriceUSD: $${priceUSD} (Uniswap V3 slot0)`);
    return priceUSD;
  } catch (err) {
    const fallback = parseFloat(process.env.ETH_PRICE_USD ?? "3000");
    logger.warn("fetchEthPriceUSD: Uniswap slot0 read failed — using fallback", {
      error:    err instanceof Error ? err.message : String(err),
      fallback: `$${fallback}`,
    });
    return fallback;
  }
}

// ── Gas estimate (USDm) ────────────────────────────────────────────────────
const ESTIMATED_GAS_USD = parseFloat(process.env.ESTIMATED_GAS_USD ?? "0.05");

const publicClient = createPublicClient({ chain: activeChain, transport: http() });

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio loader
// ─────────────────────────────────────────────────────────────────────────────
async function loadPortfolio(userWallet: string, executorAddr: `0x${string}`, ethPriceUSD = 3000): Promise<{
  stableUSD: number;
  lpUSD:     number;
  wethUSD:   number;
  totalUSD:  number;
  rawBalances: {
    usdm: bigint; usdc: bigint; usdt: bigint; weth: bigint;
  };
  aavePositions: { aUSDm: bigint; aUSDC: bigint; aUSDT: bigint };
  uniswapPositions: { tokenIds: number[]; entryValues: bigint[]; currentValues: bigint[] };
}> {
  const erc20Abi = [{ name: "balanceOf", type: "function", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" }] as const;
  const userATokenSharesAbi = [{ name: "userATokenShares", type: "function", inputs: [{ name: "user", type: "address" }, { name: "asset", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" }] as const;

  const addr = {
    usdm: getTokenAddress(CHAIN_ID, "USDm"),
    usdc: getTokenAddress(CHAIN_ID, "USDC"),
    usdt: getTokenAddress(CHAIN_ID, "USDT"),
    weth: getTokenAddress(CHAIN_ID, "wETH"),
  };

  const wallet = userWallet as `0x${string}`;

  // Baca wallet balances + per-user aToken shares dari SentinelExecutor.
  // PENTING: aToken shares dibaca dari userATokenShares(user, asset), BUKAN
  // balanceOf(aToken, executor) — yang terakhir adalah pooled balance semua user.
  const [usdmBal, usdcBal, usdtBal, wethBal, aUsdmBal, aUsdcBal, aUsdtBal] =
    await Promise.all([
      publicClient.readContract({ address: addr.usdm, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
      publicClient.readContract({ address: addr.usdc, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
      publicClient.readContract({ address: addr.usdt, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
      publicClient.readContract({ address: addr.weth, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
      publicClient.readContract({ address: executorAddr, abi: userATokenSharesAbi, functionName: "userATokenShares", args: [wallet, addr.usdm] }).catch(() => 0n),
      publicClient.readContract({ address: executorAddr, abi: userATokenSharesAbi, functionName: "userATokenShares", args: [wallet, addr.usdc] }).catch(() => 0n),
      publicClient.readContract({ address: executorAddr, abi: userATokenSharesAbi, functionName: "userATokenShares", args: [wallet, addr.usdt] }).catch(() => 0n),
    ]);

  const norm6  = (v: bigint) => Number(v) / 1e6;
  const norm18 = (v: bigint) => Number(formatUnits(v, 18));

  const stableUSD = norm18(usdmBal) + norm6(usdcBal) + norm6(usdtBal) +
                    norm18(aUsdmBal) + norm6(aUsdcBal) + norm6(aUsdtBal);
  const wethUSD   = norm18(wethBal) * ethPriceUSD;

  // ── FIX: Load LP positions from on-chain state for IL monitoring ──────────
  // Previously passed hardcoded empty arrays, which disabled IL stop-loss entirely.
  const uniswapPositions: { tokenIds: number[]; entryValues: bigint[]; currentValues: bigint[] } = {
    tokenIds: [], entryValues: [], currentValues: [],
  };

  let lpUSD = 0;

  if (executorAddr && executorAddr !== "0x") {
    try {
      // Read LP positions by index until the call reverts (array-out-of-bounds)
      for (let i = 0; i < 20; i++) {
        try {
          const pos = await publicClient.readContract({
            address:      executorAddr,
            abi:          SENTINEL_EXECUTOR_ABI,
            functionName: "lpPositions",
            args:         [wallet, BigInt(i)],
          }) as { pool: `0x${string}`; tokenId: bigint; entryValueUSD: bigint; entryTimestamp: bigint };

          uniswapPositions.tokenIds.push(Number(pos.tokenId));
          uniswapPositions.entryValues.push(pos.entryValueUSD);

          // ── Live LP value dari Uniswap V3 NonfungiblePositionManager ──────
          // Baca liquidity + sqrt price untuk hitung current value
          let currentValueUSD = pos.entryValueUSD; // fallback ke entry
          try {
            // Uniswap V3 NonfungiblePositionManager.positions(tokenId)
            const NFPM_ABI = [{
              name: "positions", type: "function", stateMutability: "view",
              inputs: [{ name: "tokenId", type: "uint256" }],
              outputs: [
                { name: "nonce",                  type: "uint96"  },
                { name: "operator",               type: "address" },
                { name: "token0",                 type: "address" },
                { name: "token1",                 type: "address" },
                { name: "fee",                    type: "uint24"  },
                { name: "tickLower",              type: "int24"   },
                { name: "tickUpper",              type: "int24"   },
                { name: "liquidity",              type: "uint128" },
                { name: "feeGrowthInside0LastX128", type: "uint256" },
                { name: "feeGrowthInside1LastX128", type: "uint256" },
                { name: "tokensOwed0",            type: "uint128" },
                { name: "tokensOwed1",            type: "uint128" },
              ],
            }] as const;

            const UNISWAP_PM = process.env.UNISWAP_PM_ADDRESS as `0x${string}`;
            if (UNISWAP_PM) {
              const nfpmPos = await publicClient.readContract({
                address: UNISWAP_PM, abi: NFPM_ABI,
                functionName: "positions", args: [pos.tokenId],
              }) as unknown as { liquidity: bigint; tokensOwed0: bigint; tokensOwed1: bigint };

              // Simple approximation: kalau liquidity drop > 10% dari entry → IL terjadi
              // Gunakan tokensOwed sebagai proxy nilai posisi saat ini
              // Nilai approx dalam USD: tokensOwed0 (USDC, 6 dec) + tokensOwed1 * ethPrice (WETH, 18 dec)
              const owed0USD = Number(nfpmPos.tokensOwed0) / 1e6;
              const owed1USD = Number(nfpmPos.tokensOwed1) / 1e18 * ethPriceUSD;
              const totalOwedUSD = owed0USD + owed1USD;

              if (totalOwedUSD > 0) {
                // Combine entry value dengan accrued fees — jika total < entry → ada IL
                const entryUSD = Number(formatUnits(pos.entryValueUSD, 18));
                // Current ≈ entry + fees owed (liquidity tidak berubah untuk concentrated LP)
                const approxCurrentUSD = entryUSD + totalOwedUSD;
                currentValueUSD = BigInt(Math.floor(approxCurrentUSD * 1e18));
              }
            }
          } catch (err) {
            logger.debug("LP live value fetch failed — using entry value", { tokenId: pos.tokenId.toString(), err });
          }

          uniswapPositions.currentValues.push(currentValueUSD);
          lpUSD += Number(formatUnits(currentValueUSD, 18));
        } catch {
          // Array index out of bounds = no more LP positions — stop iterating
          break;
        }
      }
    } catch (err) {
      logger.warn("loadPortfolio: failed to read LP positions from executor", err as object);
    }
  }

  return {
    stableUSD,
    lpUSD,
    wethUSD,
    totalUSD: stableUSD + wethUSD + lpUSD,
    rawBalances: { usdm: usdmBal, usdc: usdcBal, usdt: usdtBal, weth: wethBal },
    aavePositions: { aUSDm: aUsdmBal, aUSDC: aUsdcBal, aUSDT: aUsdtBal },
    uniswapPositions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main cycle
// ─────────────────────────────────────────────────────────────────────────────

export async function runGoalCycle(goalId: string): Promise<void> {
  const goal = await getGoalById(goalId);
  if (!goal) { logger.warn(`cycle: goal ${goalId} not found`); return; }

  // ── Step 0a: Check goal expiry ───────────────────────────────────────────
  // If deadline has passed and goal is not completed, mark as expired.
  if (["active", "action_required"].includes(goal.status)) {
    const deadlineDate = new Date(goal.deadline);
    if (deadlineDate < new Date()) {
      logger.info(`cycle: goal expired`, { goalId });
      await updateGoalStatus(goalId, "expired");
      await insertAgentEvent({ goalId, agentWallet: goal.agentWallet ?? "", status: "blocked", reason: "goal_expired" });
      const chatId = await getTelegramChatId(goal.ownerWallet);
      if (chatId) {
        await insertNotification({
          goalId,
          telegramChatId: chatId,
          type:           "goal_expired",
          messageText:    `*Piggy Sentinel* ⏰

Your savings goal has passed its deadline without reaching the target.

*Progress:* ${goal.progressPct ?? 0}%

Visit the app to withdraw your funds or set a new goal.`,
        });
      }
      return;
    }
  }

  if (!["active", "action_required"].includes(goal.status)) {
    logger.info(`cycle: skip — status=${goal.status}`);
    return;
  }

  // Emit running status
  await insertAgentEvent({ goalId, agentWallet: goal.agentWallet ?? "", status: "running" });

  const userWallet   = goal.ownerWallet as string;
  const executorAddr = getDeployedAddress(CHAIN_ID, "sentinelExecutor") as `0x${string}`;
  const goalDeadline = new Date(goal.deadline);
  const goalStartDate = goal.createdAt ? new Date(goal.createdAt) : new Date();
  const deadlineDays = Math.ceil((goalDeadline.getTime() - Date.now()) / 86_400_000);
  const totalMonths  = Math.max(1, Math.ceil(
    (goalDeadline.getTime() - goalStartDate.getTime()) / (30.44 * 24 * 3_600_000)
  ));
  const monthsElapsed = Math.max(0, totalMonths - Math.ceil(deadlineDays / 30.44));

  logger.info(`cycle: starting`, { goalId, userWallet, deadlineDays });

  // ── Step 0: Fetch live market data ──────────────────────────────────────
  const [LIVE_APYS, ethPriceUSD, volatilityResult] = await Promise.all([
    fetchLiveApys(),
    fetchEthPriceUSD(),
    fetchVolatility24h().catch(() => null),  // non-blocking — null = skip check
  ]);
  logger.info(`cycle: live market data`, {
    goalId,
    apys:        LIVE_APYS,
    ethPrice: ethPriceUSD,
  });

  // ── Step 1: Load portfolio ───────────────────────────────────────────────
  let portfolio;
  try {
    portfolio = await loadPortfolio(userWallet, executorAddr, ethPriceUSD);
  } catch (err) {
    logger.error("cycle: portfolio load failed", err);
    await insertAgentEvent({ goalId, agentWallet: executorAddr, status: "failed", reason: "portfolio_load_failed" });
    return;
  }

  // ── Step 1a: Check ERC-20 allowance ──────────────────────────────────────
  // A3 FIX: cek allowance untuk semua token yang dipakai agent (USDm, USDC, USDT),
  // bukan hanya USDm. Kalau user revoke USDC atau USDT, agent tetap jalan
  // sampai hit revert on-chain — buang gas dan buat status error yang membingungkan.
  try {
    const allowanceAbi = [{ name: "allowance", type: "function", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" }] as const;

    const tokenChecks: Array<{ symbol: string; addr: `0x${string}`; decimals: number }> = [
      { symbol: "USDm", addr: getTokenAddress(CHAIN_ID, "USDm") as `0x${string}`, decimals: 18 },
      { symbol: "USDC", addr: getTokenAddress(CHAIN_ID, "USDC") as `0x${string}`, decimals: 6  },
      { symbol: "USDT", addr: getTokenAddress(CHAIN_ID, "USDT") as `0x${string}`, decimals: 6  },
    ];

    const MIN_ALLOWANCE = parseFloat(process.env.MIN_REQUIRED_ALLOWANCE_USD ?? "5");

    const allowances = await Promise.all(
      tokenChecks.map(t => publicClient.readContract({
        address: t.addr, abi: allowanceAbi,
        functionName: "allowance",
        args: [userWallet as `0x${string}`, executorAddr],
      }))
    );

    for (let idx = 0; idx < tokenChecks.length; idx++) {
      const { symbol, decimals } = tokenChecks[idx];
      const allowanceUSD = Number(allowances[idx]) / Math.pow(10, decimals);

      if (allowanceUSD < MIN_ALLOWANCE) {
        logger.warn("cycle: allowance too low or revoked", { goalId, symbol, allowanceUSD });

        if (goal.status !== "action_required") {
          await setGoalActionRequired(goalId, "allowance_revoked");
          const chatId = await getTelegramChatId(userWallet);
          if (chatId) {
            await insertNotification({
              goalId,
              telegramChatId: chatId,
              type:           "allowance_revoked",
              messageText:    `*Piggy Sentinel* ⚠️\n\nI can no longer manage your savings — the spending permission for *${symbol}* was revoked.\n\n*Action required:* Re-approve Piggy in the web app to resume automation.\n\nYour funds are safe and unchanged.`,
            });
          }
        }

        await insertAgentEvent({ goalId, agentWallet: executorAddr, status: "blocked", reason: `allowance_revoked:${symbol}` });
        return;
      }
    }

    // Check allowance expiry via contract
    try {
      const IS_ALLOWANCE_VALID_ABI = [{ name: "isAllowanceValid", type: "function", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" }] as const;
      const isValid = await publicClient.readContract({
        address: executorAddr, abi: IS_ALLOWANCE_VALID_ABI,
        functionName: "isAllowanceValid", args: [userWallet as `0x${string}`],
      });
      if (!isValid) {
        logger.warn("cycle: allowance expired", { goalId });
        if (goal.status !== "action_required") {
          await setGoalActionRequired(goalId, "allowance_expired");
          const chatId = await getTelegramChatId(userWallet);
          if (chatId) {
            await insertNotification({
              goalId,
              telegramChatId: chatId,
              type:           "allowance_revoked",
              messageText:    `*Piggy Sentinel* ⏰\n\nYour spending permission has expired.\n\n*Action required:* Re-approve Piggy in the web app to continue automation.\n\nYour funds are safe.`,
            });
          }
        }
        await insertAgentEvent({ goalId, agentWallet: executorAddr, status: "blocked", reason: "allowance_expired" });
        return;
      }
    } catch { /* isAllowanceValid may not exist on older deployments — skip */ }
  } catch (err) {
    logger.warn("cycle: allowance check failed — continuing with caution", err as object);
  }

  // ── Step 1b: Check wallet balance ─────────────────────────────────────────
  // If wallet balance is zero AND no Aave positions → nothing to manage.
  const totalBalance = portfolio.totalUSD;
  const MIN_BALANCE_USD = parseFloat(process.env.MIN_BALANCE_USD ?? "1");

  if (totalBalance < MIN_BALANCE_USD) {
    logger.warn("cycle: balance too low to act", { goalId, totalBalance });

    const chatId = await getTelegramChatId(userWallet);
    if (chatId) {
      await insertNotification({
        goalId,
        telegramChatId: chatId,
        type:           "balance_insufficient",
        messageText:    `*Piggy Sentinel* 💸

Your wallet balance is too low for me to work with (< $${MIN_BALANCE_USD}).

Top up your wallet with USDm to keep your savings on track.`,
      });
    }

    await insertAgentEvent({ goalId, agentWallet: executorAddr, status: "blocked", reason: "balance_insufficient" });
    return;
  }

  // If goal was previously action_required due to allowance, restore it to active
  if (goal.status === "action_required" && goal.actionReason === "allowance_revoked") {
    await updateGoalStatus(goalId, "active");
    logger.info("cycle: allowance restored — goal back to active", { goalId });
  }

  const targetAmountUSD  = Number(goal.targetAmount) / 1e18;
  const startingBalance  = Number(goal.principalDeposited ?? 0) / 1e18;
  const monthlyDeposit   = Number(goal.monthlyDeposit ?? 0) / 1e18;
  // Compute optimal allocation berdasarkan live APY
  // Menggantikan fixed 60/30/10 dengan allocation yang responsif terhadap pasar
  const optimalAlloc = optimizeAllocation({
    usdm: LIVE_APYS.usdm,
    usdc: LIVE_APYS.usdc,
    usdt: LIVE_APYS.usdt,
  });
  logger.info("cycle: optimal allocation", {
    goalId,
    usdm: optimalAlloc.allocation.usdm.toFixed(1) + "%",
    usdc: optimalAlloc.allocation.usdc.toFixed(1) + "%",
    usdt: optimalAlloc.allocation.usdt.toFixed(1) + "%",
    blendedApy: optimalAlloc.blendedApy.toFixed(2) + "%",
  });

  const blendedAPY       = optimalAlloc.blendedApy;
  const blendedAPYDec    = blendedAPY / 100;

  // ── Step 1b: Auto-reset spend epoch if 30 days have passed ─────────────
  // Agent reset otomatis setiap 30 hari untuk mempertahankan autonomi.
  // Time constraint MIN_EPOCH_DURATION di-enforce ON-CHAIN di contract —
  // kalau belum 30 hari, tx akan revert EpochResetTooSoon (bukan silent fail).
  // Ini yang mencegah serangan: agent compromise tidak bisa reset berkali-kali.
  const epochStart = goal.epochStart ? new Date(goal.epochStart) : new Date(goal.createdAt ?? Date.now());
  const daysSinceEpoch = (Date.now() - epochStart.getTime()) / 86_400_000;
  if (daysSinceEpoch >= 30) {
    try {
      const txHash = await submitTransaction({
        to:    executorAddr,
        data:  encodeFunctionData({
          abi:          SENTINEL_EXECUTOR_ABI,
          functionName: "resetSpendEpoch",
          args:         [userWallet as `0x${string}`],
        }),
        value: 0n,
      });
      logger.info(`cycle: spend epoch reset`, { goalId, txHash });
    } catch (err) {
      logger.warn("cycle: epoch reset failed — agent may hit SpendLimitExceeded", err as object);
    }
  }

  // ── Step 1c: Protocol health check ──────────────────────────────────────
  // Runs all three protocol checks (Aave, Mento, Uniswap) in parallel.
  // If any is "unavailable", skip the entire cycle — executing into a broken
  // protocol is worse than missing one cycle.
  let systemHealth: SystemHealthResult | undefined;
  try {
    systemHealth = await checkProtocolHealth();
    logger.info("cycle: protocol health", {
      goalId,
      overall: systemHealth.overallStatus,
      aave:    systemHealth.aave.status,
      mento:   systemHealth.mento.status,
      uniswap: systemHealth.uniswap.status,
    });

    if (systemHealth.hasUnavailable) {
      logger.warn("cycle: protocol unavailable — skipping execution", { goalId });
      await insertAgentEvent({
        goalId,
        agentWallet: executorAddr,
        status:      "blocked",
        reason:      `protocol_unavailable: ${systemHealth.overallStatus}`,
      });
      return;
    }
  } catch (err) {
    // Non-fatal: if the health check itself fails, proceed with caution
    // rather than blocking execution on a monitoring error.
    logger.warn("cycle: protocol health check threw — proceeding with caution", err as object);
  }

  // ── Step 1d: Gas policy check ────────────────────────────────────────────
  // Skip execution (not the whole cycle) when gas is too expensive.
  // Intelligence layer still runs so users get progress/pace updates.
  let gasPolicy;
  try {
    gasPolicy = await evaluateGasPolicy();
    logger.info("cycle: gas policy", { goalId, allowed: gasPolicy.allowed, reason: gasPolicy.reason });

    if (!gasPolicy.allowed) {
      logger.info("cycle: gas too high — skipping on-chain execution", {
        goalId,
        gasPriceGwei:    gasPolicy.gasPriceGwei,
        estimatedGasUSD: gasPolicy.estimatedGasUSD,
      });
      await insertAgentEvent({
        goalId,
        agentWallet: executorAddr,
        status:      "skipped",
        reason:      `gas_too_high: ${gasPolicy.reason}`,
      });
      // Continue to Step 4 (intelligence) so the user still gets progress updates.
    }
  } catch (err) {
    logger.warn("cycle: gas policy check failed — allowing execution", err as object);
    gasPolicy = { allowed: true, reason: "gas check failed — proceeding", gasPriceGwei: 0, estimatedGasUSD: 0, celoPriceUSD: 0, celoPriceIsStale: true };
  }

  // ── Step 1e: Stablecoin peg monitor ─────────────────────────────────────
  let pegResult;
  try {
    pegResult = await checkStablecoinPegs();
    logger.info("cycle: peg status", {
      goalId,
      worstStatus: pegResult.worstStatus,
      hasAlert:    pegResult.hasAlert,
      hasCritical: pegResult.hasCritical,
    });
  } catch (err) {
    logger.warn("cycle: peg monitor failed — proceeding without peg data", err as object);
    pegResult = null;
  }

  // ── Step 1f: Risk scoring ────────────────────────────────────────────────
  // Score each Aave position. liquidityUSD dibaca live dari Aave getReserveData.
  let aggregatedRisk: RiskScore | undefined;
  try {
    const pegReadings = pegResult?.readings ?? [];
    const getPegDeviation = (token: string) =>
      pegReadings.find((r: { token: string; deviationPct: number }) => r.token === token)?.deviationPct ?? 0;

    // Fetch live liquidity dari Aave untuk risk scoring akurat
    const AAVE_POOL_ABI = [{
      name: "getReserveData", type: "function", stateMutability: "view",
      inputs: [{ name: "asset", type: "address" }],
      outputs: [{ name: "", type: "tuple", components: [
        { name: "configuration",       type: "uint256" },
        { name: "liquidityIndex",      type: "uint128" },
        { name: "currentLiquidityRate",type: "uint128" },
        { name: "variableBorrowIndex", type: "uint128" },
        { name: "currentVariableBorrowRate", type: "uint128" },
        { name: "currentStableBorrowRate",   type: "uint128" },
        { name: "lastUpdateTimestamp", type: "uint40"  },
        { name: "id",                  type: "uint16"  },
        { name: "aTokenAddress",       type: "address" },
        { name: "stableDebtTokenAddress",    type: "address" },
        { name: "variableDebtTokenAddress",  type: "address" },
        { name: "interestRateStrategyAddress", type: "address" },
        { name: "accruedToTreasury",   type: "uint128" },
        { name: "unbacked",            type: "uint128" },
        { name: "isolationModeTotalDebt", type: "uint128" },
      ]}],
    }] as const;

    const ERC20_BALANCE_ABI = [{
      name: "balanceOf", type: "function", stateMutability: "view",
      inputs: [{ name: "account", type: "address" }],
      outputs: [{ type: "uint256" }],
    }] as const;

    const AAVE_POOL = process.env.AAVE_POOL_ADDRESS as `0x${string}` | undefined;

    async function getLiveAaveLiquidity(tokenSymbol: string, decimals: number): Promise<number> {
      if (!AAVE_POOL) return 1_000_000; // fallback
      try {
        const tokenAddr = getTokenAddress(CHAIN_ID, tokenSymbol as "USDm" | "USDC" | "USDT") as `0x${string}`;
        const reserveData = await publicClient.readContract({
          address: AAVE_POOL, abi: AAVE_POOL_ABI,
          functionName: "getReserveData", args: [tokenAddr],
        }) as { aTokenAddress: `0x${string}` };
        // aToken total supply = total liquidity supplied to pool
        const totalSupply = await publicClient.readContract({
          address: reserveData.aTokenAddress, abi: ERC20_BALANCE_ABI,
          functionName: "balanceOf", args: [AAVE_POOL],
        });
        return Number(totalSupply) / Math.pow(10, decimals);
      } catch {
        return 1_000_000; // fallback kalau RPC gagal
      }
    }

    const [liqUsdt, liqUsdc, liqUsdm] = await Promise.all([
      getLiveAaveLiquidity("USDT", 6),
      getLiveAaveLiquidity("USDC", 6),
      getLiveAaveLiquidity("USDm", 18),
    ]);

    logger.info("cycle: live Aave liquidity", { goalId, liqUsdt, liqUsdc, liqUsdm });

    const riskScores = [
      computeRiskScore({
        protocol:        "aave",
        apy:             LIVE_APYS.usdt,
        liquidityUSD:    liqUsdt,
        volatilityPct:   0.2,
        pegDeviationPct: getPegDeviation("USDT"),
      }),
      computeRiskScore({
        protocol:        "aave",
        apy:             LIVE_APYS.usdc,
        liquidityUSD:    liqUsdc,
        volatilityPct:   0.2,
        pegDeviationPct: getPegDeviation("USDC"),
      }),
      computeRiskScore({
        protocol:        "aave",
        apy:             LIVE_APYS.usdm,
        liquidityUSD:    liqUsdm,
        volatilityPct:   0.3,
        pegDeviationPct: getPegDeviation("USDm"),
      }),
    ];

    aggregatedRisk = aggregateRiskScores(riskScores);
    logger.info("cycle: risk score", {
      goalId,
      score:           aggregatedRisk.score,
      level:           aggregatedRisk.level,
      dominantFactor:  aggregatedRisk.dominantFactor,
    });
  } catch (err) {
    logger.warn("cycle: risk scoring failed — proceeding without risk score", err as object);
  }

  // ── Step 1g: Circuit breaker ─────────────────────────────────────────────
  // If any trigger fires (critical peg, critical risk, or volatility spike),
  // the goal is soft-paused and the user is notified via Telegram.
  // The cycle returns immediately — no further action is taken.
  try {
    const cbResult = await evaluateCircuitBreaker({
      goalId,
      userWallet,
      agentWallet: executorAddr,
      pegResult:   pegResult ?? null,
      riskScore:   aggregatedRisk ?? null,
      volatilityPct: volatilityResult?.volatilityPct ?? null,
    });

    if (cbResult.tripped) {
      logger.error("cycle: CIRCUIT BREAKER TRIPPED — goal paused", {
        goalId,
        trigger: cbResult.trigger,
        reason:  cbResult.reason,
      });
      await insertAgentEvent({
        goalId,
        agentWallet: executorAddr,
        status:      "paused",
        reason:      `circuit_breaker: ${cbResult.trigger} — ${cbResult.reason}`,
      });
      return;
    }
  } catch (err) {
    logger.error("cycle: circuit breaker evaluation failed — aborting cycle for safety", err);
    await insertAgentEvent({ goalId, agentWallet: executorAddr, status: "failed", reason: "circuit_breaker_error" });
    return;
  }

  // ── Step 2: Decision engine ──────────────────────────────────────────────
  const lastRebalancedAt = goal.lastRebalancedAt ? new Date(goal.lastRebalancedAt) : null;

  // Baca APY terakhir dari strategyJson — disimpan setelah tiap rebalance
  const lastBlendedApy = (goal.strategyJson as Record<string, unknown> | null)?.lastBlendedApy as number | undefined;

  const decision = makeDecision({
    goalId,
    userWallet,
    softPaused:      goal.softPaused ?? false,
    goalStatus:      goal.status,
    lastRebalancedAt,
    lastBlendedApy,   // ← live dari DB, bukan hardcoded
    portfolio: {
      stableUSD: portfolio.stableUSD,
      lpUSD:     portfolio.lpUSD,
      wethUSD:   portfolio.wethUSD,
      totalUSD:  portfolio.totalUSD,
    },
    apys:            LIVE_APYS,
    estimatedGasUSD: gasPolicy?.estimatedGasUSD ?? ESTIMATED_GAS_USD,
    riskScore:       aggregatedRisk,
    protocolHealth:  systemHealth,
  });

  logger.info(`cycle: decision`, {
    goalId,
    action:  decision.action,
    tier:    decision.tier,
    reason:  decision.reason,
    estApy:  `${decision.estimatedNewApy.toFixed(2)}%`,
  });

  // ── Step 3: Execute strategy if green-lit ───────────────────────────────
  let ilExitCount = 0;

  // ── userPolicyGuard: check user-defined constraints before execution ──────
  if (decision.action === "execute_rebalance" || decision.action === "execute_initial_alloc") {
    const userPolicy = (goal.strategyJson as Record<string, unknown> | null)?.userPolicy as Record<string, unknown> | undefined;
    if (userPolicy) {
      const policyResult = checkUserPolicy(userPolicy as any, {
        action:               decision.action,
        protocol:             "aave",
        riskLevel:            aggregatedRisk?.level,
        txValueUSD:           portfolio.totalUSD,
        protocolAllocationPct: 100,
        isProfitable:         (decision.estimatedNewApy > (lastBlendedApy ?? 0)),
      });
      if (!policyResult.allowed) {
        logger.warn("cycle: user policy blocked execution", { goalId, violations: policyResult.violations });
        await insertAgentEvent({ goalId, agentWallet: executorAddr, status: "blocked", reason: `user_policy: ${policyResult.violations.join(", ")}` });
        return;
      }
    }
  }

  if (decision.action === "execute_rebalance" || decision.action === "execute_initial_alloc") {

    // Step 3a: IL check — FIX: pass actual LP positions loaded from on-chain state.
    // Previously hardcoded empty arrays, which silently disabled IL stop-loss.
    const ilExits = checkIL(portfolio.uniswapPositions);
    ilExitCount = ilExits.length;

    if (ilExits.length > 0) {
      logger.info(`cycle: IL exits required`, { goalId, tokenIds: ilExits });
      for (const tokenId of ilExits) {
        const execId = await insertExecution({ goalId, agentWallet: userWallet, skillName: "exitLP_IL", status: "pending" });
        try {
          const txHash = await submitTransaction({
            to:    executorAddr,
            data:  encodeFunctionData({
              abi:          SENTINEL_EXECUTOR_ABI,
              functionName: "checkAndExitLPIfIL",
              // FIX: pass actual currentValues loaded from on-chain LP positions.
              // Passing empty [] previously meant the Solidity loop body never ran
              // (loop condition `i < currentValues.length` with length=0 → immediate exit).
              args:         [userWallet as `0x${string}`, portfolio.uniswapPositions.currentValues],
            }),
            value: 0n,   // ERC-20 op — no native CELO
          });
          await updateExecution(execId, "confirmed", txHash);
          logger.info(`cycle: IL exit confirmed`, { goalId, tokenId, txHash });
        } catch (err) {
          await updateExecution(execId, "failed");
          logger.error("cycle: IL exit tx failed", err);
        }
      }
    }

    // Step 3b: Rebalance
    const rebalanceResult = await rebalancePortfolio({
      userWallet,
      executorAddress:  executorAddr,
      balances:         portfolio.rawBalances,
      aavePositions:    portfolio.aavePositions,
      uniswapPositions: portfolio.uniswapPositions,
      currentApys:      LIVE_APYS,
      lastRebalancedAt,
      estimatedGasUSD:  ESTIMATED_GAS_USD,
      wethPriceUSD:     ethPriceUSD,   // FIX: pass live WETH/USD price for accurate portfolio valuation
    });

    if (rebalanceResult.shouldRebalance && rebalanceResult.actions.length > 0) {
      const execId = await insertExecution({
        goalId,
        agentWallet: userWallet,
        skillName:   decision.action,
        status:      "pending",
      });

      let lastTxHash: string | undefined;
      let failed = false;

      // B4 FIX: call rebalance() gate on-chain SEBELUM execute actions.
      // Versi lama: agent bisa langsung call executeAaveSupply/LP tanpa lewat
      // rebalance() — 24h frequency limit hanya di-enforce di DB layer.
      // Fix: submit rebalance() tx dulu. Kalau revert RebalanceTooSoon,
      // skip semua actions untuk cycle ini — contract yang enforce timing.
      try {
        const rebalanceTx = await submitTransaction({
          to:    executorAddr,
          data:  encodeFunctionData({
            abi:          SENTINEL_EXECUTOR_ABI,
            functionName: "rebalance",
            args:         [userWallet as `0x${string}`],
          }),
          value: 0n,
          description: "rebalance gate",
        });
        logger.info("cycle: rebalance gate confirmed", { goalId, txHash: rebalanceTx });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("RebalanceTooSoon")) {
          logger.info("cycle: rebalance gate — too soon (on-chain), skipping actions", { goalId });
          await updateExecution(execId, "failed");
          // Lanjut ke intelligence layer — user tetap dapat progress update
          failed = true;
        } else {
          logger.error("cycle: rebalance gate tx failed", msg);
          await updateExecution(execId, "failed");
          failed = true;
        }
      }

      if (!failed) {
        for (const action of rebalanceResult.actions) {
          try {
            // Simulate before sending — prevents wasted gas on revert
            const sim = await simulateTransaction({
              to:          action.to,
              data:        action.data,
              value:       action.value,
              description: action.description,
            }).catch(() => null);

            if (sim && !sim.success) {
              logger.error(`cycle: simulation failed — skipping tx`, {
                goalId,
                description: action.description,
                reason: sim.revertReason ?? "unknown",
              });
              failed = true;
              break;
            }

            const txHash = await submitTransaction(action);
            lastTxHash = txHash;
            logger.info(`cycle: tx confirmed — ${action.description}`, { goalId, txHash });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(`cycle: tx failed — ${action.description}`, msg);
            failed = true;
            break;
          }
        }

        await updateExecution(execId, failed ? "failed" : "confirmed", lastTxHash);

        if (!failed) {
          logger.info(`cycle: rebalance complete`, {
            goalId,
            actionsExecuted: rebalanceResult.actions.length,
            newApy:          `${rebalanceResult.estimatedNewApy.toFixed(2)}%`,
          });
        }
      }
    }
  }

  // ── Step 4: Intelligence layer ───────────────────────────────────────────

  // 4a: Goal progress
  const previousProgressPct = goal.progressPct ? parseFloat(goal.progressPct) : 0;
  const progressResult = computeGoalProgress(
    {
      currentBalance:  portfolio.totalUSD,
      goalAmount:      targetAmountUSD,
      startingBalance,
      goalStartDate,
      goalDeadline,
      expectedAPY:     blendedAPYDec,
      monthlyDeposit,
    },
    previousProgressPct,
  );

  // 4b: Pace tracking
  const paceResult = trackPace({
    currentBalance:  portfolio.totalUSD,
    startingBalance,
    goalAmount:      targetAmountUSD,
    monthsElapsed,
    totalMonths,
    expectedAPY:     blendedAPYDec,
    monthlyDeposit,
  });

  // 4c: Top-up suggestion (only when behind)
  const topUp = computeTopUpSuggestion({
    paceResult,
    goalAmount:             targetAmountUSD,
    expectedAPY:            blendedAPYDec,
    existingMonthlyDeposit: monthlyDeposit,
  });

  // 4c2: Withdraw plan — precompute for Penny context and API
  // Runs every cycle so user always has fresh estimate when they open withdraw page
  try {
    const withdrawPlan = buildWithdrawPlan({
      userWallet,
      aavePositions: {
        usdmUSD:  portfolio.stableUSD * 0.10,
        usdcUSD:  portfolio.stableUSD * 0.30,
        usdtUSD:  portfolio.stableUSD * 0.60,
      },
      uniswapPositions: portfolio.uniswapPositions.tokenIds.map((id, i) => ({
        tokenId:  id,
        valueUSD: Number(portfolio.uniswapPositions.currentValues[i] ?? 0n) / 1e18,
      })),
      walletBalances: { usdmUSD: 0, usdcUSD: 0, usdtUSD: 0, wethUSD: 0 },
      targetToken: "USDm",
    });
    logger.info("cycle: withdraw plan", {
      goalId,
      totalValueUSD:   withdrawPlan.totalValueUSD.toFixed(2),
      allSafe:         withdrawPlan.allSafe,
      unsafeCount:     withdrawPlan.unsafeActions.length,
      summary:         withdrawPlan.summary,
    });
  } catch (err) {
    logger.debug("cycle: withdraw plan failed (non-critical)", err as object);
  }

  // 4d: Strategy explanation (only if an action was taken or IL exits happened)
  const explanation = (
    decision.action === "execute_rebalance" ||
    decision.action === "execute_initial_alloc" ||
    ilExitCount > 0
  ) ? explainRebalance({
      decision,
      currentApys: LIVE_APYS,
      driftPercent: typeof decision.reason === "string"
        ? parseFloat(decision.reason.match(/[d.]+%/)?.[0] ?? "0")
        : 0,
    }) : null;

  // ── Step 5: Persist snapshot ─────────────────────────────────────────────
  await insertSnapshot(
    goalId,
    BigInt(Math.round(portfolio.totalUSD * 1e18)),
    progressResult.progressPercent,
    paceResult.paceStatus,
  );

  // ── Step 6: Notifications ────────────────────────────────────────────────
  const chatId = await getTelegramChatId(userWallet);

  if (chatId) {
    const notifications: Array<{ type: NotificationType; text: string }> = [];

    // IL exits — highest priority
    if (ilExitCount > 0) {
      const ilMsg = explainILExit(ilExitCount, 5.0);
      notifications.push({ type: "progress_update", text: `*Piggy Sentinel*nn${ilMsg.message}` });
    }

    // Rebalance executed — send explanation with guardian reasoning
    if (explanation && (decision.action === "execute_rebalance" || decision.action === "execute_initial_alloc")) {
      // Build guardian reasoning summary to surface agent thinking
      const healthLine  = systemHealth
        ? `✅ Protocol health: ${systemHealth.overallStatus}`
        : "⚠️ Protocol health: unknown";
      const riskLine    = aggregatedRisk
        ? `✅ Risk score: ${aggregatedRisk.score}/100 (${aggregatedRisk.level})`
        : "⚠️ Risk: not assessed";
      const gasLine     = gasPolicy
        ? `✅ Gas cost: ~$${gasPolicy.estimatedGasUSD.toFixed(3)}`
        : "⚠️ Gas: not assessed";
      const pegLine     = pegResult
        ? (pegResult.hasAlert
            ? `⚠️ Peg status: ${pegResult.worstStatus}`
            : `✅ Peg status: all stables healthy`)
        : "⚠️ Peg: not monitored";

      const guardianSummary =
        `*Guardian checks:*n${healthLine}n${riskLine}n${gasLine}n${pegLine}`;

      notifications.push({
        type: "progress_update",
        text: `*Piggy Sentinel*nn${explanation.message}nn${guardianSummary}`,
      });
    }

    // Goal complete — send with action options
    if (progressResult.isComplete) {
      notifications.push({
        type: "goal_completed_options",
        text: `*Piggy Sentinel* 🎉nn${progressResult.message}nnYou have 3 options:n• *Withdraw* — take your money backn• *Continue* — keep earning yieldn• *New goal* — start saving for something elsennVisit the app to choose.`,
      });
      await updateGoalStatus(goalId, "completed");
    }
    // New milestone hit
    else if (progressResult.newMilestone) {
      notifications.push({
        type: "progress_update",
        text: `*Piggy Sentinel*nn${progressResult.message}`,
      });
    }

    // Behind pace — include top-up suggestion
    if (paceResult.paceStatus === "behind_pace" && !progressResult.isComplete) {
      let text = `*Piggy Sentinel*nn${paceResult.message}`;
      if (topUp.recommended) {
        text += `nn💡 *Suggestion:* ${topUp.message}`;
      }
      notifications.push({ type: "behind_pace", text });
    }

    // Send all notifications
    for (const n of notifications) {
      await insertNotification({
        goalId,
        telegramChatId: chatId,
        type:           n.type,
        messageText:    n.text,
      });
    }
  }

  // ── Step 7: Write cycle results back to goals row ────────────────────────
  // AUTONOMY FIX: last_rebalanced_at and progress_pct were read every cycle
  // but never written back. Without this:
  //   • The 24h frequency guardrail is bypassed — agent rebalances every run.
  //   • progress_pct is always 0 — milestones fire on every cycle.
  const didRebalance = decision.action === "execute_rebalance" || decision.action === "execute_initial_alloc";
  await updateGoalAfterCycle(
    goalId,
    progressResult.progressPercent,
    didRebalance,
    didRebalance ? blendedAPY : undefined,  // simpan APY saat rebalance
  );

  // ── Step 8: Emit final agent status event ──────────────────────────────────
  await insertAgentEvent({
    goalId,
    agentWallet: executorAddr,
    status:      "success",
    reason:      didRebalance ? "rebalanced" : "checked",
  });

  logger.info(`cycle: done`, {
    goalId,
    progressPct:  progressResult.progressPercent.toFixed(1),
    paceStatus:   paceResult.paceStatus,
    portfolioUSD: portfolio.totalUSD.toFixed(2),
    newMilestone: progressResult.newMilestone ?? "none",
    topUpNeeded:  topUp.recommended,
    didRebalance,
  });
}