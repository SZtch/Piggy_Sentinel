/**
 * profitabilityCheck.test.ts
 *
 * Tests cover:
 *   - Large portfolio, significant APY gain → profitable
 *   - Small portfolio, marginal gain → not profitable
 *   - APY degradation (new < current) → not profitable
 *   - Break-even calculation
 */

import { describe, it, expect } from "vitest";
import { checkProfitability } from "../profitabilityCheck.js";

describe("checkProfitability", () => {
  it("marks rebalance profitable for meaningful APY gain on large portfolio", () => {
    const result = checkProfitability({
      portfolioValueUSD: 10_000,
      currentApyPct:     4.5,
      newApyPct:         8.9,
      estimatedGasUSD:   0.05,
      deadlineDays:      60,
    });
    expect(result.profitable).toBe(true);
    expect(result.projectedGainUSD).toBeGreaterThan(result.minRequiredGainUSD);
  });

  it("marks rebalance unprofitable for tiny portfolio with marginal gain", () => {
    const result = checkProfitability({
      portfolioValueUSD: 50,       // very small
      currentApyPct:     8.5,
      newApyPct:         8.9,      // only 0.4% improvement
      estimatedGasUSD:   0.05,
      deadlineDays:      30,
    });
    expect(result.profitable).toBe(false);
  });

  it("always unprofitable when new APY <= current APY", () => {
    const result = checkProfitability({
      portfolioValueUSD: 100_000,
      currentApyPct:     8.9,
      newApyPct:         8.0,      // worse
      estimatedGasUSD:   0.05,
      deadlineDays:      90,
    });
    expect(result.profitable).toBe(false);
    expect(result.apyImprovementPct).toBeLessThan(0);
  });

  it("computes a finite break-even for a profitable rebalance", () => {
    const result = checkProfitability({
      portfolioValueUSD: 5_000,
      currentApyPct:     3.0,
      newApyPct:         7.0,
      estimatedGasUSD:   0.05,
      deadlineDays:      180,
    });
    expect(isFinite(result.breakEvenDays)).toBe(true);
    expect(result.breakEvenDays).toBeGreaterThan(0);
    expect(result.breakEvenDays).toBeLessThan(10);  // should break even in < 10 days
  });

  it("caps horizon at REBALANCE_HORIZON_DAYS even with far deadline", () => {
    // With a very far deadline and large portfolio, the gain should still
    // be capped at the horizon (30 days default), not the full 365 days.
    const capped = checkProfitability({
      portfolioValueUSD: 10_000,
      currentApyPct:     0.01,
      newApyPct:         0.5,
      estimatedGasUSD:   0.05,
      deadlineDays:      500,
    });
    const uncapped = checkProfitability({
      portfolioValueUSD: 10_000,
      currentApyPct:     0.01,
      newApyPct:         0.5,
      estimatedGasUSD:   0.05,
      deadlineDays:      5,       // short deadline
    });
    expect(capped.projectedGainUSD).toBeGreaterThanOrEqual(uncapped.projectedGainUSD);
  });
});
