/**
 * allocationOptimizer
 *
 * Dynamically computes the optimal allocation percentages for the three
 * Piggy stablecoins (USDm, USDC, USDT) based on live Aave APYs.
 *
 * Strategy:
 *   Base: USDT 60%, USDC 30%, USDm 10% (matches the static default).
 *   When live APYs differ significantly from historical baseline, the
 *   optimizer shifts weight towards higher-yield assets subject to:
 *     - Min allocation per asset (prevents complete zero-out)
 *     - Max allocation per asset (prevents over-concentration)
 *     - User policy constraints (if provided)
 *
 * Algorithm: proportional APY weighting with clamping.
 *   weight_i = APY_i / sum(APY_j)
 *   allocation_i = clamp(weight_i, MIN_ALLOC, MAX_ALLOC)
 *   Then re-normalize so sum = 100%.
 *
 * Env overrides:
 *   ALLOC_MIN_PCT  (default 5)   — no asset goes below 5%
 *   ALLOC_MAX_PCT  (default 75)  — no asset exceeds 75%
 */

import { logger } from "@piggy/shared";
import type { TokenSymbol } from "@piggy/config/tokens";

// ── Types ─────────────────────────────────────────────────────────────────

export interface ApyMap {
  usdm: number;
  usdc: number;
  usdt: number;
}

export interface AllocationMap {
  usdm: number;  // basis points (0–10000)
  usdc: number;
  usdt: number;
}

export interface OptimizerResult {
  allocation:    AllocationMap;
  /** Estimated blended APY after applying this allocation */
  blendedApy:    number;
  /** Deviation from the static default (for logging) */
  driftFromDefault: AllocationMap;
  reason:        string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const STATIC_DEFAULT: AllocationMap = { usdm: 1000, usdc: 3000, usdt: 6000 };

const MIN_ALLOC_BPS = parseInt(process.env.ALLOC_MIN_PCT ?? "5") * 100;   // 5% → 500 bps
const MAX_ALLOC_BPS = parseInt(process.env.ALLOC_MAX_PCT ?? "75") * 100;  // 75% → 7500 bps

// ── Helpers ───────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Normalize three values so they sum to 10000 bps */
function normalize(a: number, b: number, c: number): [number, number, number] {
  const sum = a + b + c;
  if (sum === 0) return [3333, 3334, 3333];
  return [
    Math.round((a / sum) * 10000),
    Math.round((b / sum) * 10000),
    10000 - Math.round((a / sum) * 10000) - Math.round((b / sum) * 10000),
  ];
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Compute the optimal allocation for the three Piggy stablecoins.
 *
 * @example
 * const result = optimizeAllocation({ usdm: 1.07, usdc: 2.61, usdt: 8.89 });
 * // With these APYs the optimizer weights heavily towards USDT
 */
export function optimizeAllocation(
  apys:            ApyMap,
  userConstraints?: Partial<AllocationMap>,
): OptimizerResult {

  // Ensure all APYs are positive — negative/zero APY means paused market,
  // assign a tiny epsilon so weight calculation stays stable
  const safeApys = {
    usdm: Math.max(apys.usdm, 0.01),
    usdc: Math.max(apys.usdc, 0.01),
    usdt: Math.max(apys.usdt, 0.01),
  };

  const totalApy = safeApys.usdm + safeApys.usdc + safeApys.usdt;

  // Proportional weights (unclamped), in basis points
  let rawUsdm = (safeApys.usdm / totalApy) * 10000;
  let rawUsdc = (safeApys.usdc / totalApy) * 10000;
  let rawUsdt = (safeApys.usdt / totalApy) * 10000;

  // Clamp each to [MIN, MAX] — respecting per-asset user constraints
  const minUsdm = userConstraints?.usdm != null ? userConstraints.usdm : MIN_ALLOC_BPS;
  const maxUsdm = MAX_ALLOC_BPS;
  const minUsdc = userConstraints?.usdc != null ? userConstraints.usdc : MIN_ALLOC_BPS;
  const maxUsdc = MAX_ALLOC_BPS;
  const minUsdt = userConstraints?.usdt != null ? userConstraints.usdt : MIN_ALLOC_BPS;
  const maxUsdt = MAX_ALLOC_BPS;

  const clampedUsdm = clamp(rawUsdm, minUsdm, maxUsdm);
  const clampedUsdc = clamp(rawUsdc, minUsdc, maxUsdc);
  const clampedUsdt = clamp(rawUsdt, minUsdt, maxUsdt);

  // Re-normalize after clamping
  const [finalUsdm, finalUsdc, finalUsdt] = normalize(clampedUsdm, clampedUsdc, clampedUsdt);

  const allocation: AllocationMap = { usdm: finalUsdm, usdc: finalUsdc, usdt: finalUsdt };

  const blendedApy =
    apys.usdm * (finalUsdm / 10000) +
    apys.usdc * (finalUsdc / 10000) +
    apys.usdt * (finalUsdt / 10000);

  const driftFromDefault: AllocationMap = {
    usdm: finalUsdm - STATIC_DEFAULT.usdm,
    usdc: finalUsdc - STATIC_DEFAULT.usdc,
    usdt: finalUsdt - STATIC_DEFAULT.usdt,
  };

  const reason =
    `Optimized: USDm ${(finalUsdm / 100).toFixed(0)}% / ` +
    `USDC ${(finalUsdc / 100).toFixed(0)}% / ` +
    `USDT ${(finalUsdt / 100).toFixed(0)}%. ` +
    `Blended APY: ${blendedApy.toFixed(2)}%.`;

  logger.info("allocationOptimizer", {
    apys,
    allocation,
    blendedApy: blendedApy.toFixed(2),
  });

  return { allocation, blendedApy, driftFromDefault, reason };
}

/** Convert bps allocation to a human-readable summary string */
export function formatAllocation(a: AllocationMap): string {
  return `USDm ${(a.usdm / 100).toFixed(0)}% / USDC ${(a.usdc / 100).toFixed(0)}% / USDT ${(a.usdt / 100).toFixed(0)}%`;
}
