import { logger }           from "@piggy/shared";
import { getTokenAddress }  from "@piggy/config/tokens";
import { CHAIN_ID }         from "@piggy/config/chains";
import {
  encodeFunctionData,
  parseUnits,
  formatUnits,
  type Address,
} from "viem";
import { SENTINEL_EXECUTOR_ABI } from "@piggy/shared";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AssetSymbol = "USDm" | "USDC" | "USDT" | "wETH";
export type Protocol    = "aave" | "uniswap" | "mento";

/** Basis points precision (10_000 = 100%) */
const BPS = 10_000n;

export interface TokenBalances {
  usdm: bigint;   // 18 decimals
  usdc: bigint;   // 6 decimals — normalised to 18 internally
  usdt: bigint;   // 6 decimals — normalised to 18 internally
  weth: bigint;   // 18 decimals
}

export interface AavePositions {
  aUSDm: bigint;
  aUSDC: bigint;
  aUSDT: bigint;
}

export interface UniswapPositions {
  /** Active LP token IDs owned by the user */
  tokenIds:     number[];
  /** Entry value in USD (18 dec) per position, same order as tokenIds */
  entryValues:  bigint[];
  /** Current value in USD (18 dec) per position, same order as tokenIds */
  currentValues: bigint[];
}

export interface CurrentApys {
  usdm: number;
  usdc: number;
  usdt: number;
}

/** Input to the strategy engine */
export interface RebalanceInput {
  userWallet:        string;
  executorAddress:   string;
  /** All wallet balances (raw chain units) */
  balances:          TokenBalances;
  aavePositions:     AavePositions;
  uniswapPositions:  UniswapPositions;
  /** Live Aave APYs as percentages (e.g. 8.89) */
  currentApys:       CurrentApys;
  lastRebalancedAt:  Date | null;
  /** Estimated gas cost in USD (float) */
  estimatedGasUSD:   number;
  /**
   * Current WETH/USD price as a float (e.g. 2000.50).
   * REQUIRED for accurate portfolio valuation. If omitted, defaults to $0
   * which causes the engine to always treat WETH holdings as worthless,
   * misclassify portfolio tier, and miscalculate all allocation percentages.
   * Fetch from Coingecko, Chainlink, or Redstone before calling this function.
   */
  wethPriceUSD:      number;
}

export interface TxCalldata {
  to:          Address;
  data:        `0x${string}`;
  /** Native CELO value — always 0n for ERC-20 operations */
  value:       bigint;
  description: string;
}

export interface RebalanceDecision {
  shouldRebalance: boolean;
  skipReason?:     string;
  tier:            PortfolioTier;
  /** USD value (float) */
  portfolioUSD:    number;
  /** Allocation that the engine is targeting */
  targetAlloc:     TargetAllocation;
  /** Actions to execute in order */
  actions:         TxCalldata[];
  ilExitsRequired: number[];  // tokenIds to exit due to IL breach
  estimatedNewApy: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Tiers
// ─────────────────────────────────────────────────────────────────────────────

export type PortfolioTier =
  | "nano"    // < $50   — Aave only, no swaps
  | "small"   // $50–200 — Aave stable yield
  | "mid"     // $200–1000 — Aave + LP
  | "large";  // > $1000 — dynamic allocation

export interface TargetAllocation {
  /** Basis points to keep in Aave stable (USDT/USDC/USDm) */
  stableBps: number;
  /** Basis points to put into Uniswap LP */
  lpBps:     number;
  /** Basis points to hold as WETH (volatile) */
  wethBps:   number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MIN_REBALANCE_USD         = 200;          // $200 minimum portfolio
const REBALANCE_INTERVAL_MS     = 24 * 60 * 60 * 1000;
const DRIFT_THRESHOLD_BPS       = 1_000;        // 10% drift triggers rebalance
const MAX_LP_BPS                = 3_000;        // 30% hard cap
const IL_STOP_LOSS_BPS          = 500;          // 5% IL triggers exit
const SLIPPAGE_BPS              = 100n;         // 1% max slippage
const ONE_18                    = parseUnits("1", 18);

/** Tier allocation rules (bps, must sum to 10_000) */
const TIER_ALLOCATIONS: Record<PortfolioTier, TargetAllocation> = {
  nano:  { stableBps: 10_000, lpBps:    0, wethBps:    0 },
  small: { stableBps: 10_000, lpBps:    0, wethBps:    0 },
  mid:   { stableBps:  8_000, lpBps: 2_000, wethBps:   0 },
  large: { stableBps:  6_000, lpBps: 3_000, wethBps: 1_000 },
};

/** Within the stable bucket: USDT 60%, USDC 30%, USDm 10% */
const STABLE_SPLIT = { usdt: 6_000n, usdc: 3_000n, usdm: 1_000n };

// ─────────────────────────────────────────────────────────────────────────────
// Swap Routing Rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Route a swap to the correct protocol.
 *
 * Rules:
 *   Mento only:  USDm ↔ USDC,  USDm ↔ USDT
 *   Uniswap:     anything involving WETH
 *   Never:       Mento with WETH
 */
export function routeSwap(
  from: AssetSymbol,
  to:   AssetSymbol,
): Protocol {
  if (from === "wETH" || to === "wETH") {
    return "uniswap";
  }
  // Both stablecoins — use Mento
  const stable: AssetSymbol[] = ["USDm", "USDC", "USDT"];
  if (stable.includes(from) && stable.includes(to)) {
    return "mento";
  }
  // Fallback
  return "uniswap";
}

function assertNotMentoWETH(from: AssetSymbol, to: AssetSymbol) {
  if ((from === "wETH" || to === "wETH") && routeSwap(from, to) === "mento") {
    throw new Error(`INVARIANT: Mento must never be used to swap into/from WETH`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Normalise 6-decimal token (USDC/USDT) to 18 decimals for arithmetic */
function norm6to18(amount: bigint): bigint {
  return amount * 10n ** 12n;
}

/**
 * De-normalise an amount from 18-dec back to 6-dec (for USDC / USDT).
 * CRITICAL: must be applied before passing amounts to contract calls for
 * 6-decimal tokens, otherwise transferFrom / Aave supply will attempt to
 * move 10^12× more tokens than exist and always revert.
 */
function norm18to6(amount: bigint): bigint {
  return amount / 10n ** 12n;
}

function portfolioTier(usd: number): PortfolioTier {
  if (usd <   50) return "nano";
  if (usd <  200) return "small";
  if (usd < 1000) return "mid";
  return "large";
}

/**
 * Current allocation in bps derived from live position values.
 * aave+wallet stable vs LP vs weth.
 */
function currentAllocBps(
  stableTotal: bigint,
  lpTotal:     bigint,
  wethTotal:   bigint,
  grand:       bigint,
): { stableBps: number; lpBps: number; wethBps: number } {
  if (grand === 0n) return { stableBps: 10_000, lpBps: 0, wethBps: 0 };
  return {
    stableBps: Number((stableTotal * 10_000n) / grand),
    lpBps:     Number((lpTotal     * 10_000n) / grand),
    wethBps:   Number((wethTotal   * 10_000n) / grand),
  };
}

function driftBps(current: number, target: number): number {
  return Math.abs(current - target);
}

function applySlippage(amount: bigint): bigint {
  return (amount * (10_000n - SLIPPAGE_BPS)) / 10_000n;
}

function blendedApy(alloc: TargetAllocation, apys: CurrentApys): number {
  const stableApy = apys.usdt * 0.6 + apys.usdc * 0.3 + apys.usdm * 0.1;
  return (alloc.stableBps / 10_000) * stableApy;
}

// ─────────────────────────────────────────────────────────────────────────────
// Calldata Builders
// ─────────────────────────────────────────────────────────────────────────────

function buildMentoSwapAndSupply(
  executor:     Address,
  user:         Address,
  fromAddr:     Address,
  toAddr:       Address,
  amountIn:     bigint,    // USDm amount (18-dec)
  minAmountOut: bigint,    // expected output dalam OUTPUT token native decimals (6-dec untuk USDC/USDT)
  fromSymbol:   AssetSymbol,
  toSymbol:     AssetSymbol,
): TxCalldata {
  assertNotMentoWETH(fromSymbol, toSymbol);
  // minATokens = 99% dari minAmountOut (slippage Aave sangat kecil untuk stable)
  const minATokens = (minAmountOut * 9_900n) / 10_000n;
  return {
    to:   executor,
    data: encodeFunctionData({
      abi:          SENTINEL_EXECUTOR_ABI,
      functionName: "executeMentoSwapAndSupply",
      args:         [user, fromAddr, toAddr, amountIn, minAmountOut, minATokens],
    }),
    value:       0n,
    description: `MentoSwapAndSupply ${formatUnits(amountIn, 18)} ${fromSymbol} → ${toSymbol} → Aave`,
  };
}

function buildUniswapSwap(
  executor:   Address,
  user:       Address,
  fromAddr:   Address,
  toAddr:     Address,
  amountIn:   bigint,
  fromSymbol: AssetSymbol,
  toSymbol:   AssetSymbol,
): TxCalldata {
  return {
    to:   executor,
    data: encodeFunctionData({
      abi:          SENTINEL_EXECUTOR_ABI,
      functionName: "executeUniswapSwap",
      args:         [user, fromAddr, toAddr, amountIn, applySlippage(amountIn)],
    }),
    value:       0n,
    description: `Uniswap swap ${formatUnits(amountIn, 18)} ${fromSymbol} → ${toSymbol}`,
  };
}

function buildAaveSupply(
  executor: Address,
  user:     Address,
  asset:    Address,
  amount:   bigint,
  symbol:   AssetSymbol,
): TxCalldata {
  return {
    to:   executor,
    data: encodeFunctionData({
      abi:          SENTINEL_EXECUTOR_ABI,
      functionName: "executeAaveSupply",
      args:         [user, asset, amount, applySlippage(amount)],
    }),
    value:       0n,
    description: `Aave supply ${formatUnits(amount, 18)} ${symbol}`,
  };
}

function buildUniswapLP(
  executor:     Address,
  user:         Address,
  token0:       Address,
  token1:       Address,
  amount0:      bigint,
  amount1:      bigint,
  totalUSD:     bigint,
  portfolioUSD: bigint,
): TxCalldata {
  return {
    to:   executor,
    data: encodeFunctionData({
      abi:          SENTINEL_EXECUTOR_ABI,
      functionName: "executeUniswapLP",
      args:         [user, token0, token1, amount0, amount1, totalUSD, portfolioUSD],
    }),
    value:       0n,
    description: `Uniswap LP ${formatUnits(amount0, 18)} USDC + ${formatUnits(amount1, 18)} WETH`,
  };
}

function buildRebalanceGate(executor: Address, user: Address): TxCalldata {
  return {
    to:   executor,
    data: encodeFunctionData({
      abi:          SENTINEL_EXECUTOR_ABI,
      functionName: "rebalance",
      args:         [user],
    }),
    value:       0n,
    description: "Rebalance gate — record timestamp on-chain",
  };
}

/**
 * Forward sisa token yang parkir di SentinelExecutor ke userWallet.
 * Dipanggil setelah LP sequence selesai (executeAaveWithdraw → swap → LP).
 * Jika ada sisa USDC/WETH yang tidak terpakai karena refund Uniswap V3,
 * ini memastikan token tersebut sampai ke user, bukan stuck di kontrak.
 */
function buildForwardToUser(
  executor: Address,
  user:     Address,
  assets:   Address[],
): TxCalldata {
  return {
    to:   executor,
    data: encodeFunctionData({
      abi:          SENTINEL_EXECUTOR_ABI,
      functionName: "forwardToUser",
      args:         [user, assets],
    }),
    value:       0n,
    description: `Forward sisa token ke userWallet: ${assets.join(", ")}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// IL Check
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns tokenIds where IL > 5%.
 * These must be exited before new positions are opened.
 */
export function checkIL(positions: UniswapPositions): number[] {
  const exits: number[] = [];
  for (let i = 0; i < positions.tokenIds.length; i++) {
    const entry   = positions.entryValues[i]   ?? 0n;
    const current = positions.currentValues[i] ?? 0n;
    if (entry === 0n || current >= entry) continue;

    const lossBps = Number(((entry - current) * 10_000n) / entry);
    if (lossBps >= IL_STOP_LOSS_BPS) {
      exits.push(positions.tokenIds[i]);
      logger.warn("IL stop-loss triggered", {
        tokenId:  positions.tokenIds[i],
        lossBps,
        entry:    entry.toString(),
        current:  current.toString(),
      });
    }
  }
  return exits;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Strategy Engine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Piggy Sentinel strategy engine.
 *
 * Decision model:
 *   1. Compute portfolio USD value
 *   2. Determine tier → target allocation
 *   3. Check guardrails (min portfolio, frequency, drift)
 *   4. Check IL on existing LP positions
 *   5. Build ordered calldata to rebalance to target
 *
 * Swap routing:
 *   USDm ↔ USDC / USDT  → Mento (stable-only)
 *   *    ↔ WETH          → Uniswap
 *   Never Mento for WETH
 */
export async function rebalancePortfolio(
  input: RebalanceInput,
): Promise<RebalanceDecision> {
  const {
    userWallet, executorAddress,
    balances, aavePositions, uniswapPositions,
    currentApys, lastRebalancedAt, estimatedGasUSD, wethPriceUSD,
  } = input;

  const user     = userWallet    as Address;
  const executor = executorAddress as Address;

  const addr = {
    usdm: getTokenAddress(CHAIN_ID, "USDm") as Address,
    usdc: getTokenAddress(CHAIN_ID, "USDC") as Address,
    usdt: getTokenAddress(CHAIN_ID, "USDT") as Address,
    weth: getTokenAddress(CHAIN_ID, "wETH") as Address,
  };

  // ── 1. Portfolio valuation (all normalised to 18 dec) ─────────────────────
  const walletStable = (
    norm6to18(balances.usdc) +
    norm6to18(balances.usdt) +
    balances.usdm
  );
  const aaveStable = (
    norm6to18(aavePositions.aUSDC) +
    norm6to18(aavePositions.aUSDT) +
    aavePositions.aUSDm
  );
  const stableTotal = walletStable + aaveStable;

  // FIX: wethTotal must be converted to USD-equivalent before summing.
  // Previously: wethTotal = balances.weth (raw 18-dec WETH units, treated as $1 each).
  // This caused 1 WETH (~$2000) to be valued at $0.000000000000000001 in USD,
  // making the portfolio tier, allocation math, and gas ratio check all wrong.
  //
  // Correct approach: wethTotalUSD = wethAmount * wethPriceUSD (as 18-dec fixed-point).
  // wethPriceUSD is provided by the caller from a live price feed.
  const wethPriceFixed = parseUnits(wethPriceUSD.toFixed(18), 18);  // e.g. 2000.50 → 2000.5 * 1e18
  const wethTotal      = (balances.weth * wethPriceFixed) / ONE_18; // USD-equivalent, 18 dec

  // LP value = sum of current values
  const lpTotal = uniswapPositions.currentValues.reduce(
    (acc, v) => acc + v, 0n
  );

  const grandTotal = stableTotal + wethTotal + lpTotal;
  const portfolioUSD = parseFloat(formatUnits(grandTotal, 18));

  // ── 2. Determine tier ─────────────────────────────────────────────────────
  const tier       = portfolioTier(portfolioUSD);
  const targetAlloc = TIER_ALLOCATIONS[tier];

  // ── 3. Guardrail checks ───────────────────────────────────────────────────

  // G1: minimum portfolio for rebalance
  if (portfolioUSD < MIN_REBALANCE_USD) {
    return skip(tier, portfolioUSD, targetAlloc, currentApys,
      `portfolio $${portfolioUSD.toFixed(2)} below $${MIN_REBALANCE_USD} minimum`);
  }

  // G2: frequency — max once per 24h
  if (lastRebalancedAt) {
    const msSince = Date.now() - lastRebalancedAt.getTime();
    if (msSince < REBALANCE_INTERVAL_MS) {
      const hoursLeft = Math.ceil((REBALANCE_INTERVAL_MS - msSince) / 3_600_000);
      return skip(tier, portfolioUSD, targetAlloc, currentApys,
        `rebalanced recently — next in ${hoursLeft}h`);
    }
  }

  // G3: allocation drift > 10%
  const current = currentAllocBps(stableTotal, lpTotal, wethTotal, grandTotal);
  const maxDrift = Math.max(
    driftBps(current.stableBps, targetAlloc.stableBps),
    driftBps(current.lpBps,     targetAlloc.lpBps),
    driftBps(current.wethBps,   targetAlloc.wethBps),
  );

  if (maxDrift < DRIFT_THRESHOLD_BPS) {
    return skip(tier, portfolioUSD, targetAlloc, currentApys,
      `max drift ${(maxDrift / 100).toFixed(1)}% below 10% threshold`);
  }

  // ── 4. IL check — must exit before rebalancing ───────────────────────────
  const ilExitsRequired = checkIL(uniswapPositions);

  // ── 5. Gas sanity check ───────────────────────────────────────────────────
  const dailyYield = portfolioUSD * (blendedApy(targetAlloc, currentApys) / 100) / 365;
  const gasRatio   = (estimatedGasUSD / dailyYield) * 100;
  if (gasRatio > 10) {
    return skip(tier, portfolioUSD, targetAlloc, currentApys,
      `gas $${estimatedGasUSD.toFixed(3)} = ${gasRatio.toFixed(1)}% of daily yield (max 10%)`);
  }

  // ── 6. Build action calldata ──────────────────────────────────────────────
  const actions: TxCalldata[] = [];

  // Step 1: rebalance gate (records timestamp on-chain)
  actions.push(buildRebalanceGate(executor, user));

  // Step 2: determine target amounts in each bucket
  const targetStable = (grandTotal * BigInt(targetAlloc.stableBps)) / BPS;
  const targetLP     = (grandTotal * BigInt(targetAlloc.lpBps))     / BPS;
  const targetWeth   = (grandTotal * BigInt(targetAlloc.wethBps))   / BPS;

  // ── Step 3: stable bucket re-split (USDT 60% / USDC 30% / USDm 10%) ──────
  const targetUsdt = (targetStable * STABLE_SPLIT.usdt) / BPS;
  const targetUsdc = (targetStable * STABLE_SPLIT.usdc) / BPS;
  const targetUsdm = targetStable - targetUsdt - targetUsdc;

  // Current Aave stable positions
  const currentAUsdt = norm6to18(aavePositions.aUSDT);
  const currentAUsdc = norm6to18(aavePositions.aUSDC);
  const currentAUsdm = aavePositions.aUSDm;

  // Net swap needed per asset (positive = need more, negative = have excess)
  const needUsdt = targetUsdt - currentAUsdt;
  const needUsdc = targetUsdc - currentAUsdc;
  const needUsdm = targetUsdm - currentAUsdm;

  // Consolidate to USDm first (it's the input asset, no swap needed from wallet)
  // Excess USDC/USDT → swap to USDm via Mento first, then redistribute
  if (needUsdt < 0n) {
    // excess USDT — leave in Aave, don't swap out unless significant
  }
  if (needUsdc < 0n) {
    // excess USDC — leave in Aave
  }

  // Supply USDm directly if needed
  if (needUsdm > 0n && balances.usdm >= needUsdm) {
    actions.push(buildAaveSupply(executor, user, addr.usdm, needUsdm, "USDm"));
  }

  // Swap USDm → USDT if more USDT needed in Aave.
  //
  // CRITICAL DECIMAL FIX:
  //   • `swapAmt` is computed in 18-dec (all arithmetic normalised for comparisons).
  //   • `amountIn`  for Mento = USDm amount → stays 18-dec (USDm is 18 dec). ✓
  //   • `minAmountOut` for Mento = expected USDT output → must be 6-dec.        ✗ was 18-dec
  //   • `amount` for Aave supply = USDT to supply → must be 6-dec.             ✗ was 18-dec
  //   Passing 18-dec values to a 6-dec token contract means the amounts are
  //   10^12× too large. transferFrom would always fail (insufficient allowance).
  if (needUsdt > 0n) {
    const swapAmt18 = needUsdt < balances.usdm ? needUsdt : balances.usdm;
    if (swapAmt18 > 0n) {
      const swapAmt6 = norm18to6(swapAmt18); // convert expected USDT output to 6-dec
      // Atomic: USDm → USDT via Mento + supply USDT ke Aave dalam 1 tx
      actions.push(buildMentoSwapAndSupply(executor, user, addr.usdm, addr.usdt, swapAmt18, swapAmt6, "USDm", "USDT"));
    }
  }

  // Swap USDm → USDC if more USDC needed in Aave.
  // Same decimal logic as USDT above.
  if (needUsdc > 0n) {
    const remaining  = balances.usdm - (needUsdt > 0n ? needUsdt : 0n);
    const swapAmt18  = needUsdc < remaining ? needUsdc : remaining;
    if (swapAmt18 > 0n) {
      const swapAmt6 = norm18to6(swapAmt18); // convert expected USDC output to 6-dec
      // Atomic: USDm → USDC via Mento + supply USDC ke Aave dalam 1 tx
      actions.push(buildMentoSwapAndSupply(executor, user, addr.usdm, addr.usdc, swapAmt18, swapAmt6, "USDm", "USDC"));
    }
  }

  // ── Step 4: LP allocation (mid and large tier only) ───────────────────────
  if (targetAlloc.lpBps > 0 && targetLP > 0n) {
    const currentLPTotal = lpTotal;
    const lpGap = targetLP - currentLPTotal;

    if (lpGap > 0n) {
      // Enter new LP: USDC/WETH pair via Uniswap
      // Need to acquire WETH: swap USDC → WETH via Uniswap (NEVER Mento — Mento has no WETH pair)
      const lpUsdc18 = lpGap / 2n;   // half in USDC (18-dec for comparisons)
      const lpWeth   = lpGap / 2n;   // half in WETH (18-dec — WETH is 18 dec)
      const lpUsdc6  = norm18to6(lpUsdc18); // de-normalise to 6-dec for USDC contract calls

      if (norm6to18(balances.usdc) >= lpUsdc18) {
        // Uniswap swap: USDC → WETH (volatile pair — correct protocol)
        // FIX: amountIn harus lpUsdc6 (6-dec USDC), bukan lpWeth (18-dec)
        // Sebelumnya pakai lpWeth sebagai amountIn yang nilainya sama tapi
        // interpretasinya salah — swap USDC butuh amount dalam 6 desimal
        actions.push(buildUniswapSwap(executor, user, addr.usdc, addr.weth, lpUsdc6, "USDC", "wETH"));

        actions.push(buildUniswapLP(
          executor, user,
          addr.usdc, addr.weth,
          lpUsdc6, lpWeth,  // USDC = 6-dec, WETH = 18-dec
          lpGap, grandTotal,
        ));

        // Forward sisa token (refund dari Uniswap V3 tick range) ke userWallet
        actions.push(buildForwardToUser(executor, user, [addr.usdc, addr.weth]));
      }
    }
  }

  // ── Step 5: WETH allocation (large tier only) ─────────────────────────────
  if (targetAlloc.wethBps > 0 && targetWeth > wethTotal) {
    const wethNeeded = targetWeth - wethTotal;
    // Uniswap swap: USDC → WETH (volatile pair — NEVER Mento, which has no WETH pair)
    assertNotMentoWETH("USDC", "wETH"); // safety invariant check
    actions.push(buildUniswapSwap(executor, user, addr.usdc, addr.weth, wethNeeded, "USDC", "wETH"));
  }

  const estApy = blendedApy(targetAlloc, currentApys);

  logger.info("rebalancePortfolio: decision made", {
    wallet:      userWallet,
    tier,
    portfolioUSD: portfolioUSD.toFixed(2),
    maxDrift:    `${(maxDrift / 100).toFixed(1)}%`,
    actions:     actions.length,
    ilExits:     ilExitsRequired.length,
    estApy:      `${estApy.toFixed(2)}%`,
    target:      targetAlloc,
  });

  return {
    shouldRebalance: true,
    tier,
    portfolioUSD,
    targetAlloc,
    actions,
    ilExitsRequired,
    estimatedNewApy: estApy,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: skip
// ─────────────────────────────────────────────────────────────────────────────

function skip(
  tier:       PortfolioTier,
  usd:        number,
  alloc:      TargetAllocation,
  apys:       CurrentApys,
  reason:     string,
): RebalanceDecision {
  logger.info("rebalancePortfolio: skip", { reason, portfolioUSD: usd.toFixed(2) });
  return {
    shouldRebalance: false,
    skipReason:      reason,
    tier,
    portfolioUSD:    usd,
    targetAlloc:     alloc,
    actions:         [],
    ilExitsRequired: [],
    estimatedNewApy: blendedApy(alloc, apys),
  };
}
