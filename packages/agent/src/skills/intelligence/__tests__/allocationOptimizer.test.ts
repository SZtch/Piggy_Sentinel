/**
 * allocationOptimizer.test.ts
 *
 * Pure function — no mocks needed.
 * Tests cover:
 *   - Proportional APY weighting
 *   - MIN/MAX clamping
 *   - Re-normalization to exactly 10000 bps
 *   - Blended APY calculation
 *   - User constraint floor overrides
 *   - Zero/negative APY edge cases
 */

import { describe, it, expect } from "vitest";
import { optimizeAllocation, formatAllocation } from "../allocationOptimizer.js";

// Baseline APYs matching Piggy's defaults
const BASELINE = { usdm: 1.07, usdc: 2.61, usdt: 8.89 };

describe("optimizeAllocation: normalization", () => {
  it("always sums allocation bps to exactly 10000", () => {
    const { allocation } = optimizeAllocation(BASELINE);
    expect(allocation.usdm + allocation.usdc + allocation.usdt).toBe(10000);
  });

  it("sums to 10000 regardless of APY ratios", () => {
    const configs = [
      { usdm: 0.1, usdc: 0.1, usdt: 0.1 },   // equal
      { usdm: 50,  usdc: 0.1, usdt: 0.1 },   // one dominant
      { usdm: 0.1, usdc: 50,  usdt: 50  },   // two dominant
    ];
    for (const apys of configs) {
      const { allocation: a } = optimizeAllocation(apys);
      expect(a.usdm + a.usdc + a.usdt).toBe(10000);
    }
  });
});

describe("optimizeAllocation: proportional weighting", () => {
  it("weights USDT highest when it has the highest APY", () => {
    const { allocation } = optimizeAllocation(BASELINE);
    expect(allocation.usdt).toBeGreaterThan(allocation.usdc);
    expect(allocation.usdc).toBeGreaterThan(allocation.usdm);
  });

  it("weights equally when all APYs are the same", () => {
    const { allocation } = optimizeAllocation({ usdm: 5, usdc: 5, usdt: 5 });
    // With equal weights, after clamping to [500, 7500] and normalization
    // each should be roughly 3333 bps (±1 for rounding)
    expect(allocation.usdm).toBeCloseTo(3333, -2);
    expect(allocation.usdc).toBeCloseTo(3333, -2);
    expect(allocation.usdt).toBeCloseTo(3333, -2);
  });
});

describe("optimizeAllocation: clamping", () => {
  it("no asset falls below MIN_ALLOC_BPS (500 bps = 5%)", () => {
    // Very lopsided: USDT 100x higher — without clamping USDm/USDC would → 0
    const { allocation } = optimizeAllocation({ usdm: 0.01, usdc: 0.01, usdt: 99 });
    expect(allocation.usdm).toBeGreaterThanOrEqual(500);
    expect(allocation.usdc).toBeGreaterThanOrEqual(500);
  });

  it("no asset exceeds MAX_ALLOC_BPS (7500 bps = 75%)", () => {
    const { allocation } = optimizeAllocation({ usdm: 99, usdc: 0.01, usdt: 0.01 });
    expect(allocation.usdm).toBeLessThanOrEqual(7500);
  });
});

describe("optimizeAllocation: blended APY", () => {
  it("blended APY is between min and max individual APY", () => {
    const { blendedApy } = optimizeAllocation(BASELINE);
    expect(blendedApy).toBeGreaterThan(BASELINE.usdm);
    expect(blendedApy).toBeLessThan(BASELINE.usdt);
  });

  it("blended APY is close to weighted average", () => {
    const apys = { usdm: 2, usdc: 4, usdt: 6 };
    const { allocation, blendedApy } = optimizeAllocation(apys);
    const expected =
      apys.usdm * (allocation.usdm / 10000) +
      apys.usdc * (allocation.usdc / 10000) +
      apys.usdt * (allocation.usdt / 10000);
    expect(blendedApy).toBeCloseTo(expected, 4);
  });
});

describe("optimizeAllocation: user constraints", () => {
  it("respects a minimum USDm allocation set by user", () => {
    // User wants at least 20% in USDm (2000 bps)
    const { allocation } = optimizeAllocation(BASELINE, { usdm: 2000 });
    expect(allocation.usdm).toBeGreaterThanOrEqual(2000);
    expect(allocation.usdm + allocation.usdc + allocation.usdt).toBe(10000);
  });
});

describe("optimizeAllocation: edge cases", () => {
  it("handles zero APY without throwing (epsilon substitution)", () => {
    expect(() => optimizeAllocation({ usdm: 0, usdc: 0, usdt: 0 })).not.toThrow();
    const { allocation } = optimizeAllocation({ usdm: 0, usdc: 0, usdt: 0 });
    expect(allocation.usdm + allocation.usdc + allocation.usdt).toBe(10000);
  });

  it("handles negative APY without throwing", () => {
    expect(() => optimizeAllocation({ usdm: -1, usdc: 3, usdt: 5 })).not.toThrow();
  });
});

describe("formatAllocation", () => {
  it("returns a human-readable percentage string", () => {
    const result = formatAllocation({ usdm: 1000, usdc: 3000, usdt: 6000 });
    expect(result).toBe("USDm 10% / USDC 30% / USDT 60%");
  });
});
