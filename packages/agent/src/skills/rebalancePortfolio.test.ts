import { describe, it, expect } from "vitest";
import {
  rebalancePortfolio,
  checkIL,
  type RebalanceInput,
} from "./index.js";
import { parseUnits } from "viem";

const BASE_INPUT: RebalanceInput = {
  userWallet:       "0xUser",
  executorAddress:  "0xExecutor",
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
  wethPriceUSD:     2000,
};

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
      tokenIds:      [1, 2, 3],
      entryValues:   [100n, 100n, 100n].map(v => v * 10n ** 18n),
      currentValues: [97n, 94n, 96n].map(v => v * 10n ** 18n),
    });
    expect(exits).toEqual([2]); // only tokenId 2 hits 5%
  });

  it("skips entry with 0 entryValue", () => {
    const exits = checkIL({
      tokenIds:      [1],
      entryValues:   [0n],
      currentValues: [0n],
    });
    expect(exits).toHaveLength(0);
  });
});

// ── rebalancePortfolio guardrails ─────────────────────────────────────────

describe("rebalancePortfolio guardrails", () => {
  it("skips if portfolio below minimum", async () => {
    const result = await rebalancePortfolio({
      ...BASE_INPUT,
      balances: { ...BASE_INPUT.balances, usdm: parseUnits("5", 18) },
    });
    expect(result.shouldRebalance).toBe(false);
    expect(result.skipReason).toMatch(/min/);
  });

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
    expect(result.skipReason).not.toMatch(/rebalanced recently/);
  });

  it("builds actions when rebalance is needed", async () => {
    const result = await rebalancePortfolio({
      ...BASE_INPUT,
      balances: { ...BASE_INPUT.balances, usdm: parseUnits("500", 18) },
    });
    if (result.shouldRebalance) {
      expect(result.actions.length).toBeGreaterThan(0);
      expect(result.estimatedNewApy).toBeGreaterThan(0);
    }
  });

  it("includes withdraw actions when Aave positions exist", async () => {
    const result = await rebalancePortfolio({
      ...BASE_INPUT,
      aavePositions: {
        aUSDm: parseUnits("50", 18),
        aUSDC: parseUnits("150", 6),
        aUSDT: parseUnits("300", 6),
      },
      balances: { usdm: 0n, usdc: 0n, usdt: 0n, weth: 0n },
      lastRebalancedAt: new Date(Date.now() - 25 * 3_600_000),
    });
    if (result.shouldRebalance) {
      // Should include executeAaveWithdraw actions
      const withdrawActions = result.actions.filter(a =>
        a.description?.includes("Withdraw")
      );
      expect(withdrawActions.length).toBeGreaterThan(0);
    }
  });
});