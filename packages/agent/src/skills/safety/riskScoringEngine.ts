/**
 * riskScoringEngine
 *
 * Produces a composite risk score (0–100) for a position or rebalance action.
 *
 * Score components (each 0–100, weighted):
 *   - apyRisk          (20%) — abnormally high APY signals unsustainability
 *   - liquidityRisk    (25%) — shallow pool depth amplifies slippage + exit risk
 *   - volatilityRisk   (25%) — asset price volatility (stables near 0, WETH higher)
 *   - pegDeviationRisk (30%) — stablecoin peg break is the highest severity event
 *
 * Thresholds mirror Aave's own risk framework and Mento peg monitors.
 *
 * Output:
 *   score     0–33  → LOW
 *   score    34–66  → MEDIUM
 *   score    67–89  → HIGH
 *   score    90–100 → CRITICAL (triggers circuitBreaker)
 */

import { logger } from "@piggy/shared";

// ── Types ─────────────────────────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskInput {
  /** Protocol being assessed: "aave" | "mento" | "uniswap" */
  protocol: "aave" | "mento" | "uniswap";

  /** Annual percentage yield for this position (e.g. 8.5 for 8.5%) */
  apy: number;

  /**
   * Total available liquidity in USD.
   * Aave: total pool liquidity.
   * Uniswap: pool TVL.
   * Mento: broker reserves.
   */
  liquidityUSD: number;

  /**
   * 24-hour price volatility as a percentage (e.g. 2.5 for 2.5%).
   * Stablecoins should be < 0.5 under normal conditions.
   */
  volatilityPct: number;

  /**
   * For stablecoins: absolute deviation from $1.00 peg in percent.
   * E.g. $0.985 → pegDeviationPct = 1.5
   * Pass 0 for non-stable assets.
   */
  pegDeviationPct: number;

  /**
   * Optional: pool depth in USD at ±2% price range (Uniswap concentrated liquidity).
   * Smaller depth → higher slippage risk.
   */
  poolDepthUSD?: number;
}

export interface RiskScore {
  score:          number;
  level:          RiskLevel;
  components: {
    apyRisk:          number;
    liquidityRisk:    number;
    volatilityRisk:   number;
    pegDeviationRisk: number;
  };
  /** Human-readable dominant risk factor */
  dominantFactor: string;
  /** Recommended action based on risk level */
  recommendation: string;
}

// ── Scoring helpers ────────────────────────────────────────────────────────

/**
 * APY risk: sustainable yield for stablecoins is 2–12%.
 * Anything above 20% is likely unsustainable or points to protocol stress.
 */
function scoreApy(apy: number, protocol: RiskInput["protocol"]): number {
  // Uniswap LP can legitimately have higher APY due to fee income
  const ceiling = protocol === "uniswap" ? 80 : 25;
  if (apy <= 0)        return 5;   // 0% yield is suspicious (paused pool)
  if (apy < 3)         return 0;
  if (apy < 12)        return 10;
  if (apy < 20)        return 30;
  if (apy < ceiling)   return 55;
  return 80;
}

/**
 * Liquidity risk: < $1M in a pool used for meaningful allocation is dangerous.
 * Celo is a smaller chain so thresholds are lower than Ethereum mainnet.
 */
function scoreLiquidity(liquidityUSD: number, poolDepthUSD?: number): number {
  const depth = poolDepthUSD ?? liquidityUSD;
  if (depth <= 0)           return 100;
  if (depth < 50_000)       return 90;
  if (depth < 250_000)      return 70;
  if (depth < 1_000_000)    return 45;
  if (depth < 5_000_000)    return 20;
  return 5;
}

/**
 * Volatility risk: stablecoins should show < 0.5% daily; WETH typically 3–8%.
 */
function scoreVolatility(volatilityPct: number): number {
  if (volatilityPct < 0.3)  return 0;
  if (volatilityPct < 1.0)  return 15;
  if (volatilityPct < 3.0)  return 35;
  if (volatilityPct < 8.0)  return 60;
  if (volatilityPct < 15.0) return 80;
  return 100;
}

/**
 * Peg deviation risk: a 1% depeg is unusual; 3%+ is a crisis.
 * This is the highest-weight component — peg breaks destroy stable value.
 */
function scorePegDeviation(pegDeviationPct: number): number {
  if (pegDeviationPct <= 0.1)  return 0;
  if (pegDeviationPct <= 0.3)  return 10;
  if (pegDeviationPct <= 0.5)  return 25;
  if (pegDeviationPct <= 1.0)  return 50;
  if (pegDeviationPct <= 2.0)  return 75;
  if (pegDeviationPct <= 3.0)  return 90;
  return 100;   // > 3% depeg → critical
}

function levelFor(score: number): RiskLevel {
  if (score <= 33) return "low";
  if (score <= 66) return "medium";
  if (score <= 89) return "high";
  return "critical";
}

function recommendationFor(level: RiskLevel): string {
  switch (level) {
    case "low":      return "No action required. Position within normal risk bounds.";
    case "medium":   return "Monitor closely. Consider reducing allocation if risk increases.";
    case "high":     return "Reduce exposure or rebalance to safer protocol. Do not increase allocation.";
    case "critical": return "Exit position immediately and pause agent execution.";
  }
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Compute a composite risk score for a single position or intended action.
 *
 * @example
 * const risk = computeRiskScore({
 *   protocol:        "aave",
 *   apy:             8.9,
 *   liquidityUSD:    4_200_000,
 *   volatilityPct:   0.2,
 *   pegDeviationPct: 0.05,
 * });
 * // → { score: 12, level: "low", ... }
 */
export function computeRiskScore(input: RiskInput): RiskScore {
  const apyRisk          = scoreApy(input.apy, input.protocol);
  const liquidityRisk    = scoreLiquidity(input.liquidityUSD, input.poolDepthUSD);
  const volatilityRisk   = scoreVolatility(input.volatilityPct);
  const pegDeviationRisk = scorePegDeviation(input.pegDeviationPct);

  // Weighted composite
  const score = Math.round(
    apyRisk          * 0.20 +
    liquidityRisk    * 0.25 +
    volatilityRisk   * 0.25 +
    pegDeviationRisk * 0.30,
  );

  const level = levelFor(score);

  // Find dominant factor for human-readable explanation
  const factors: [string, number][] = [
    ["APY sustainability",    apyRisk],
    ["Protocol liquidity",    liquidityRisk],
    ["Price volatility",      volatilityRisk],
    ["Stablecoin peg health", pegDeviationRisk],
  ];
  const [dominantFactor] = factors.reduce((a, b) => (b[1] > a[1] ? b : a));

  const result: RiskScore = {
    score,
    level,
    components: { apyRisk, liquidityRisk, volatilityRisk, pegDeviationRisk },
    dominantFactor,
    recommendation: recommendationFor(level),
  };

  logger.info("riskScoringEngine: scored", {
    protocol: input.protocol,
    score,
    level,
    dominantFactor,
  });

  return result;
}

/**
 * Aggregate risk across multiple positions (returns worst-case score).
 * Used by the circuit breaker to decide whether to pause the agent.
 */
export function aggregateRiskScores(scores: RiskScore[]): RiskScore {
  if (scores.length === 0) {
    return {
      score: 0,
      level: "low",
      components: { apyRisk: 0, liquidityRisk: 0, volatilityRisk: 0, pegDeviationRisk: 0 },
      dominantFactor: "none",
      recommendation: "No positions to evaluate.",
    };
  }
  // Return the highest-score (worst) individual result
  return scores.reduce((worst, s) => (s.score > worst.score ? s : worst));
}
