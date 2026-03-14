/**
 * riskScoringEngine.test.ts
 *
 * Tests cover:
 *   - Normal healthy Aave position → low risk
 *   - Unsustainably high APY → medium/high risk
 *   - Critical peg deviation → critical risk
 *   - Aggregation returns worst-case
 */

import { describe, it, expect } from "vitest";
import {
  computeRiskScore,
  aggregateRiskScores,
  type RiskInput,
} from "../riskScoringEngine.js";

const HEALTHY_AAVE: RiskInput = {
  protocol:        "aave",
  apy:             8.9,
  liquidityUSD:    5_000_000,
  volatilityPct:   0.15,
  pegDeviationPct: 0.05,
};

describe("computeRiskScore", () => {
  it("scores a healthy Aave USDT position as low risk", () => {
    const result = computeRiskScore(HEALTHY_AAVE);
    expect(result.level).toBe("low");
    expect(result.score).toBeLessThan(34);
  });

  it("scores an unsustainably high APY as medium/high", () => {
    const result = computeRiskScore({ ...HEALTHY_AAVE, apy: 45 });
    expect(["medium", "high"]).toContain(result.level);
  });

  it("scores critical peg deviation as critical", () => {
    const result = computeRiskScore({ ...HEALTHY_AAVE, pegDeviationPct: 3.5 });
    expect(result.level).toBe("critical");
    expect(result.score).toBeGreaterThanOrEqual(90);
  });

  it("scores low liquidity as high/critical", () => {
    const result = computeRiskScore({ ...HEALTHY_AAVE, liquidityUSD: 10_000 });
    expect(["high", "critical"]).toContain(result.level);
  });

  it("scores high volatility as elevated risk", () => {
    const result = computeRiskScore({ ...HEALTHY_AAVE, volatilityPct: 12 });
    expect(result.score).toBeGreaterThan(30);
  });

  it("has a dominant factor that is the highest-weight component", () => {
    const result = computeRiskScore({ ...HEALTHY_AAVE, pegDeviationPct: 2.5 });
    expect(result.dominantFactor).toBe("Stablecoin peg health");
  });

  it("Uniswap allows higher APY before triggering elevated risk", () => {
    const uniswap = computeRiskScore({
      protocol: "uniswap", apy: 50,
      liquidityUSD: 2_000_000, volatilityPct: 5, pegDeviationPct: 0,
    });
    const aave = computeRiskScore({
      protocol: "aave", apy: 50,
      liquidityUSD: 2_000_000, volatilityPct: 5, pegDeviationPct: 0,
    });
    expect(uniswap.components.apyRisk).toBeLessThanOrEqual(aave.components.apyRisk);
  });
});

describe("aggregateRiskScores", () => {
  it("returns empty/low result for empty array", () => {
    const result = aggregateRiskScores([]);
    expect(result.level).toBe("low");
    expect(result.score).toBe(0);
  });

  it("returns the worst score from a mixed set", () => {
    const low      = computeRiskScore(HEALTHY_AAVE);
    const critical = computeRiskScore({ ...HEALTHY_AAVE, pegDeviationPct: 4 });
    const result   = aggregateRiskScores([low, critical]);
    expect(result.level).toBe("critical");
  });
});
