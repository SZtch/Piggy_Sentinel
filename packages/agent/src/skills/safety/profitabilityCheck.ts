/**
 * profitabilityCheck
 *
 * Ensures every rebalance or migration action is economically rational:
 * the projected yield improvement over the holding period must exceed
 * the gas cost paid to execute the action.
 *
 * Formula:
 *   annualYieldGainUSD  = portfolioValueUSD × (newAPY − currentAPY) / 100
 *   holdingPeriodYield  = annualYieldGainUSD × (holdingDays / 365)
 *   profitable          = holdingPeriodYield > gasUSD × MIN_PROFIT_MULTIPLIER
 *
 * MIN_PROFIT_MULTIPLIER (default 2×): ensures we gain at least 2× gas cost
 * before moving funds — a conservative guard against micro-rebalances that
 * burn gas for negligible yield improvement.
 *
 * Env overrides:
 *   MIN_PROFIT_MULTIPLIER     (default 2.0)
 *   REBALANCE_HORIZON_DAYS    (default 30 — how far ahead to project gains)
 */

import { logger } from "@piggy/shared";

// ── Types ─────────────────────────────────────────────────────────────────

export interface ProfitabilityInput {
  /** Total portfolio value in USD currently deployed in this strategy */
  portfolioValueUSD: number;

  /** Current blended APY across all positions (e.g. 4.5 for 4.5%) */
  currentApyPct: number;

  /** Projected blended APY after the rebalance */
  newApyPct: number;

  /** Estimated gas cost for the full rebalance action in USD */
  estimatedGasUSD: number;

  /**
   * Days until goal deadline — used as the projection horizon.
   * Capped at REBALANCE_HORIZON_DAYS to prevent over-optimistic long-range projections.
   */
  deadlineDays: number;
}

export interface ProfitabilityResult {
  profitable:           boolean;
  apyImprovementPct:    number;
  projectedGainUSD:     number;
  breakEvenDays:        number;
  gasUSD:               number;
  minRequiredGainUSD:   number;
  reason:               string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const MIN_PROFIT_MULTIPLIER = parseFloat(
  process.env.MIN_PROFIT_MULTIPLIER ?? "2.0",
);

const REBALANCE_HORIZON_DAYS = parseInt(
  process.env.REBALANCE_HORIZON_DAYS ?? "30",
);

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Determine whether a rebalance action is worth the gas cost.
 *
 * @example
 * const check = checkProfitability({
 *   portfolioValueUSD: 10_000,
 *   currentApyPct:     4.5,
 *   newApyPct:         8.9,
 *   estimatedGasUSD:   0.05,
 *   deadlineDays:      60,
 * });
 * if (!check.profitable) skip action;
 */
export function checkProfitability(input: ProfitabilityInput): ProfitabilityResult {
  const apyImprovementPct = input.newApyPct - input.currentApyPct;

  // If new APY is not better, rebalance is never profitable
  if (apyImprovementPct <= 0) {
    return {
      profitable:           false,
      apyImprovementPct,
      projectedGainUSD:     0,
      breakEvenDays:        Infinity,
      gasUSD:               input.estimatedGasUSD,
      minRequiredGainUSD:   input.estimatedGasUSD * MIN_PROFIT_MULTIPLIER,
      reason:               `New APY (${input.newApyPct.toFixed(2)}%) is not better than current (${input.currentApyPct.toFixed(2)}%).`,
    };
  }

  const horizonDays      = Math.min(input.deadlineDays, REBALANCE_HORIZON_DAYS);
  const annualGainUSD    = input.portfolioValueUSD * (apyImprovementPct / 100);
  const projectedGainUSD = annualGainUSD * (horizonDays / 365);
  const minRequiredGainUSD = input.estimatedGasUSD * MIN_PROFIT_MULTIPLIER;

  // Break-even: days until yield improvement covers gas
  const breakEvenDays = annualGainUSD > 0
    ? (input.estimatedGasUSD / annualGainUSD) * 365
    : Infinity;

  const profitable = projectedGainUSD >= minRequiredGainUSD;

  const reason = profitable
    ? `Projected gain $${projectedGainUSD.toFixed(4)} over ${horizonDays}d exceeds ` +
      `${MIN_PROFIT_MULTIPLIER}× gas cost ($${minRequiredGainUSD.toFixed(4)}). ` +
      `Break-even in ${breakEvenDays.toFixed(1)} days.`
    : `Projected gain $${projectedGainUSD.toFixed(4)} over ${horizonDays}d is less than ` +
      `${MIN_PROFIT_MULTIPLIER}× gas cost ($${minRequiredGainUSD.toFixed(4)}). ` +
      `Rebalance not economically justified.`;

  logger.info("profitabilityCheck", {
    portfolioValueUSD:   input.portfolioValueUSD,
    apyImprovementPct:   apyImprovementPct.toFixed(3),
    projectedGainUSD:    projectedGainUSD.toFixed(4),
    minRequiredGainUSD:  minRequiredGainUSD.toFixed(4),
    breakEvenDays:       isFinite(breakEvenDays) ? breakEvenDays.toFixed(1) : "∞",
    profitable,
  });

  return {
    profitable,
    apyImprovementPct,
    projectedGainUSD,
    breakEvenDays,
    gasUSD:              input.estimatedGasUSD,
    minRequiredGainUSD,
    reason,
  };
}
