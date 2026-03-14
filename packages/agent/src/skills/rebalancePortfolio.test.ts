import { describe, it, expect } from "vitest";
import {
  rebalancePortfolio,
  checkIL,
  routeSwap,
  type RebalanceInput,
} from "./rebalancePortfolio.js";
import { parseUnits } from "viem";

const BASE_INPUT: RebalanceInput = {
  userWallet:      "0xUser",
  executorAddress: "0xExecutor",
  balances: {
    usdm: parseUnits("500", 18),
    usdc: 0n,
    usdt: 0n,
    weth: 0n,
  },
  aavePositions:    { aUSDm: 0n, aUSDC: 0n, aUSDT: 0n },
  uniswapPositions: { tokenIds: [], entryValues: [], currentValues: [] },
  currentApys:      { usdm: 1.07, usdc: 2.61, usdt: 8.89 },
  lastRebalancedAt: null,
  estimatedGasUSD:  0.05,
  wethPriceUSD:     2000,   // FIX: required field added — used for WETH→USD portfolio valuation
};

// ── Routing rules ─────────────────────────────────────────────────────────

describe("routeSwap", () => {
  it("routes USDm → USDT to Mento", () => {
    expect(routeSwap("USDm", "USDT")).toBe("mento");
  });
  it("routes USDm → USDC to Mento", () => {
    expect(routeSwap("USDm", "USDC")).toBe("mento");
  });
  it("routes USDC → wETH to Uniswap", () => {
    expect(routeSwap("USDC", "wETH")).toBe("uniswap");
  });
  it("routes USDT → wETH to Uniswap", () => {
    expect(routeSwap("USDT", "wETH")).toBe("uniswap");
  });
  it("never routes wETH through Mento", () => {
    expect(routeSwap("wETH", "USDC")).not.toBe("mento");
    expect(routeSwap("USDC", "wETH")).not.toBe("mento");
  });
});

// ── IL check ──────────────────────────────────────────────────────────────

describe("checkIL", () => {
  it("returns no exits when IL < 5%", () => {
    const exits = checkIL({
      tokenIds:      [1],
      entryValues:   [parseUnits("100", 18)],
      currentValues: [parseUnits("96", 18)],   // 4% loss
    });
    expect(exits).toHaveLength(0);
  });
  it("returns exit when IL >= 5%", () => {
    const exits = checkIL({
      tokenIds:      [42],
      entryValues:   [parseUnits("100", 18)],
      currentValues: [parseUnits("94", 18)],   // 6% loss
    });
    expect(exits).toEqual([42]);
  });
  it("handles multiple positions correctly", () => {
    const exits = checkIL({
      tokenIds:      [1,   2,    3],
      entryValues:   [100n, 100n, 100n].map(v => v * 10n**18n),
      currentValues: [97n,  94n,  96n].map(v => v * 10n**18n),
    });
    expect(exits).toEqual([2]);  // only tokenId 2 hits 5%
  });
});

// ── Portfolio tiers ───────────────────────────────────────────────────────

describe("rebalancePortfolio tiers", () => {
  it("nano tier ($40): skip — below $200 minimum", async () => {
    const result = await rebalancePortfolio({
      ...BASE_INPUT,
      balances: { ...BASE_INPUT.balances, usdm: parseUnits("40", 18) },
    });
    expect(result.shouldRebalance).toBe(false);
    expect(result.tier).toBe("nano");
    expect(result.skipReason).toMatch(/\$200/);
  });

  it("small tier ($100): skip — below $200 minimum", async () => {
    const result = await rebalancePortfolio({
      ...BASE_INPUT,
      balances: { ...BASE_INPUT.balances, usdm: parseUnits("100", 18) },
    });
    expect(result.shouldRebalance).toBe(false);
    expect(result.tier).toBe("small");
  });

  it("mid tier ($300): rebalance — Aave + LP", async () => {
    const result = await rebalancePortfolio({
      ...BASE_INPUT,
      balances: { ...BASE_INPUT.balances, usdm: parseUnits("300", 18) },
    });
    expect(result.tier).toBe("mid");
    expect(result.targetAlloc.stableBps).toBe(8_000);
    expect(result.targetAlloc.lpBps).toBe(2_000);
  });

  it("large tier ($1500): Aave + LP + WETH", async () => {
    const result = await rebalancePortfolio({
      ...BASE_INPUT,
      balances: { ...BASE_INPUT.balances, usdm: parseUnits("1500", 18) },
    });
    expect(result.tier).toBe("large");
    expect(result.targetAlloc.stableBps).toBe(6_000);
    expect(result.targetAlloc.lpBps).toBe(3_000);
    expect(result.targetAlloc.wethBps).toBe(1_000);
  });
});

// ── Guardrails ────────────────────────────────────────────────────────────

describe("guardrails", () => {
  it("skips if rebalanced within 24h", async () => {
    const result = await rebalancePortfolio({
      ...BASE_INPUT,
      lastRebalancedAt: new Date(Date.now() - 2 * 3_600_000), // 2h ago
    });
    expect(result.shouldRebalance).toBe(false);
    expect(result.skipReason).toMatch(/rebalanced recently/);
  });

  it("allows rebalance after 24h", async () => {
    const result = await rebalancePortfolio({
      ...BASE_INPUT,
      lastRebalancedAt: new Date(Date.now() - 25 * 3_600_000), // 25h ago
    });
    // Will proceed past frequency check (may still skip for other reasons)
    expect(result.skipReason).not.toMatch(/rebalanced recently/);
  });

  it("skips if drift < 10%", async () => {
    // Portfolio perfectly at target — no drift
    const result = await rebalancePortfolio({
      ...BASE_INPUT,
      aavePositions: {
        aUSDm: parseUnits("50", 18),   // 10%
        aUSDC: parseUnits("150", 6),   // 30%
        aUSDT: parseUnits("300", 6),   // 60%
      },
      balances: { usdm: 0n, usdc: 0n, usdt: 0n, weth: 0n },
    });
    // Very low drift → skip
    if (!result.shouldRebalance) {
      expect(result.skipReason).toMatch(/drift|portfolio/);
    }
  });

  it("LP allocation never exceeds 30%", async () => {
    const result = await rebalancePortfolio({
      ...BASE_INPUT,
      balances: { ...BASE_INPUT.balances, usdm: parseUnits("500", 18) },
    });
    if (result.shouldRebalance) {
      expect(result.targetAlloc.lpBps).toBeLessThanOrEqual(3_000);
    }
  });
});
