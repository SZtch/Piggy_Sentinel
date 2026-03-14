/**
 * slippageGuard.test.ts
 *
 * Tests cover:
 *   - Aave always passes (no slippage)
 *   - Uniswap small trade in large pool → allowed
 *   - Uniswap large trade in small pool → blocked
 *   - Mento flat fee → allowed within default threshold
 *   - Missing poolTvlUSD for Uniswap → blocked (safe default)
 */

import { describe, it, expect } from "vitest";
import { checkSlippage } from "../slippageGuard.js";

describe("checkSlippage — Aave", () => {
  it("always allows Aave operations (no slippage)", () => {
    const result = checkSlippage({
      protocol:      "aave",
      tradeValueUSD: 100_000,
    });
    expect(result.allowed).toBe(true);
    expect(result.estimatedSlippagePct).toBe(0);
  });
});

describe("checkSlippage — Uniswap", () => {
  it("allows small trade in deep pool", () => {
    const result = checkSlippage({
      protocol:      "uniswap",
      tradeValueUSD: 1_000,
      poolTvlUSD:    2_000_000,
    });
    expect(result.allowed).toBe(true);
    expect(result.estimatedSlippagePct).toBeLessThan(1.0);
  });

  it("blocks large trade in shallow pool", () => {
    const result = checkSlippage({
      protocol:      "uniswap",
      tradeValueUSD: 50_000,
      poolTvlUSD:    60_000,
    });
    expect(result.allowed).toBe(false);
    expect(result.estimatedSlippagePct).toBeGreaterThan(1.0);
  });

  it("blocks when poolTvlUSD is missing", () => {
    const result = checkSlippage({
      protocol:      "uniswap",
      tradeValueUSD: 1_000,
    });
    expect(result.allowed).toBe(false);
  });

  it("respects a custom maxSlippagePct", () => {
    // Same trade, but user allows up to 5%
    const result = checkSlippage({
      protocol:       "uniswap",
      tradeValueUSD:  20_000,
      poolTvlUSD:     100_000,
      maxSlippagePct: 5.0,
    });
    // 20k trade in 100k pool → ~28% slippage → still blocked
    // (20000 / (50000 + 20000)) * 100 ≈ 28%
    expect(result.estimatedSlippagePct).toBeGreaterThan(5.0);
    expect(result.allowed).toBe(false);
  });
});

describe("checkSlippage — Mento", () => {
  it("allows typical Mento stable swap (fee 0.3% + spread 0.1% = 0.4%)", () => {
    const result = checkSlippage({
      protocol:      "mento",
      tradeValueUSD: 5_000,
      mentoFeePct:   0.30,
    });
    expect(result.estimatedSlippagePct).toBeCloseTo(0.40, 2);
    expect(result.allowed).toBe(true);
  });

  it("uses default fee of 0.30% when mentoFeePct not provided", () => {
    const result = checkSlippage({ protocol: "mento", tradeValueUSD: 1_000 });
    expect(result.estimatedSlippagePct).toBeCloseTo(0.40, 2);
    expect(result.allowed).toBe(true);
  });
});
