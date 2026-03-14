/**
 * withdrawPlanner.test.ts
 *
 * buildWithdrawPlan is pure (delegates slippage checks to the also-pure
 * checkSlippage, no I/O).  Tests cover:
 *   - Step ordering: LP exits → Aave withdrawals → Mento swaps → Uniswap swaps
 *   - Safety flags set correctly when slippage exceeds threshold
 *   - allSafe / unsafeActions aggregation
 *   - Zero-value positions are skipped
 *   - Target token selection affects which swaps are included
 */

import { describe, it, expect } from "vitest";
import { buildWithdrawPlan, type WithdrawPlanInput } from "../withdrawPlanner.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

const HEALTHY_INPUT: WithdrawPlanInput = {
  userWallet: "0xUser",
  aavePositions: {
    usdmUSD:  500,
    usdcUSD:  1500,
    usdtUSD:  3000,
  },
  uniswapPositions: [{
    tokenId:    42,
    valueUSD:   800,
    poolTvlUSD: 2_000_000,    // deep pool → low slippage
  }],
  walletBalances: {
    usdmUSD: 200,
    usdcUSD: 0,
    usdtUSD: 0,
    wethUSD: 0,
  },
  targetToken: "USDC",
  mentoPooTvlUSD: 5_000_000,
};

// ── Step ordering ──────────────────────────────────────────────────────────

describe("buildWithdrawPlan: step ordering", () => {
  it("exits LP positions before Aave withdrawals", () => {
    const { actions } = buildWithdrawPlan(HEALTHY_INPUT);
    const lpIndex   = actions.findIndex(a => a.type === "exit_lp");
    const aaveIndex = actions.findIndex(a => a.type === "aave_withdraw");
    expect(lpIndex).toBeLessThan(aaveIndex);
  });

  it("Aave withdrawals come before Mento swaps", () => {
    const { actions } = buildWithdrawPlan(HEALTHY_INPUT);
    const aaveIndex  = actions.findIndex(a => a.type === "aave_withdraw");
    const mentoIndex = actions.findIndex(a => a.type === "mento_swap");
    if (mentoIndex >= 0) {
      expect(aaveIndex).toBeLessThan(mentoIndex);
    }
  });

  it("step numbers are sequential starting from 1", () => {
    const { actions } = buildWithdrawPlan(HEALTHY_INPUT);
    actions.forEach((a, i) => {
      expect(a.step).toBe(i + 1);
    });
  });
});

// ── Zero-value skipping ────────────────────────────────────────────────────

describe("buildWithdrawPlan: zero-value positions are skipped", () => {
  it("omits Aave positions with 0 value", () => {
    const input: WithdrawPlanInput = {
      ...HEALTHY_INPUT,
      aavePositions: { usdmUSD: 0, usdcUSD: 0, usdtUSD: 1000 },
    };
    const { actions } = buildWithdrawPlan(input);
    const aaveActions = actions.filter(a => a.type === "aave_withdraw");
    expect(aaveActions).toHaveLength(1);
    expect(aaveActions[0].description).toMatch(/USDT/);
  });

  it("omits Uniswap LP positions with 0 value", () => {
    const input: WithdrawPlanInput = {
      ...HEALTHY_INPUT,
      uniswapPositions: [{ tokenId: 1, valueUSD: 0, poolTvlUSD: 1_000_000 }],
    };
    const { actions } = buildWithdrawPlan(input);
    expect(actions.filter(a => a.type === "exit_lp")).toHaveLength(0);
  });

  it("omits wallet swap when balance is below $1", () => {
    const input: WithdrawPlanInput = {
      ...HEALTHY_INPUT,
      walletBalances: { usdmUSD: 0.5, usdcUSD: 0, usdtUSD: 0, wethUSD: 0 },
    };
    const { actions } = buildWithdrawPlan(input);
    expect(actions.filter(a => a.type === "mento_swap")).toHaveLength(0);
  });
});

// ── Target token selection ─────────────────────────────────────────────────

describe("buildWithdrawPlan: target token affects swap steps", () => {
  it("does NOT swap USDm when targetToken is USDm", () => {
    const input: WithdrawPlanInput = {
      ...HEALTHY_INPUT,
      targetToken:    "USDm",
      walletBalances: { usdmUSD: 500, usdcUSD: 200, usdtUSD: 100, wethUSD: 0 },
    };
    const { actions } = buildWithdrawPlan(input);
    const swapTokens = actions
      .filter(a => a.type === "mento_swap")
      .map(a => a.description);
    // USDm should NOT appear as a token being swapped away
    expect(swapTokens.some(d => d.startsWith("Swap USDm"))).toBe(false);
    // USDC and USDT should be swapped to USDm
    expect(swapTokens.some(d => d.startsWith("Swap USDC"))).toBe(true);
    expect(swapTokens.some(d => d.startsWith("Swap USDT"))).toBe(true);
  });

  it("includes WETH→USDC swap via Uniswap when wallet holds WETH", () => {
    const input: WithdrawPlanInput = {
      ...HEALTHY_INPUT,
      walletBalances: { usdmUSD: 0, usdcUSD: 0, usdtUSD: 0, wethUSD: 500 },
      targetToken:    "USDC",
    };
    const { actions } = buildWithdrawPlan(input);
    const uniSwap = actions.find(a => a.type === "uniswap_swap");
    expect(uniSwap).toBeDefined();
    expect(uniSwap!.description).toMatch(/WETH.*USDC/);
  });
});

// ── Safety flags ───────────────────────────────────────────────────────────

describe("buildWithdrawPlan: safety flags", () => {
  it("marks allSafe:true when all steps pass slippage checks", () => {
    const { allSafe } = buildWithdrawPlan(HEALTHY_INPUT);
    expect(allSafe).toBe(true);
  });

  it("marks step safe:false and sets warning when LP pool is too shallow", () => {
    const input: WithdrawPlanInput = {
      ...HEALTHY_INPUT,
      uniswapPositions: [{
        tokenId:    99,
        valueUSD:   50_000,
        poolTvlUSD: 55_000,   // tiny pool → >1% slippage
      }],
    };
    const { actions, allSafe, unsafeActions } = buildWithdrawPlan(input);
    const lpStep = actions.find(a => a.type === "exit_lp");
    expect(lpStep?.safe).toBe(false);
    expect(lpStep?.warning).toMatch(/slippage/i);
    expect(allSafe).toBe(false);
    expect(unsafeActions).toHaveLength(1);
  });

  it("marks LP step unsafe when poolTvlUSD is missing", () => {
    const input: WithdrawPlanInput = {
      ...HEALTHY_INPUT,
      uniswapPositions: [{ tokenId: 7, valueUSD: 1000 }],  // no poolTvlUSD
    };
    const { actions } = buildWithdrawPlan(input);
    const lpStep = actions.find(a => a.type === "exit_lp");
    expect(lpStep?.safe).toBe(false);
  });
});

// ── Total value ────────────────────────────────────────────────────────────

describe("buildWithdrawPlan: totalValueUSD", () => {
  it("sums all action values correctly", () => {
    const { actions, totalValueUSD } = buildWithdrawPlan(HEALTHY_INPUT);
    const sum = actions.reduce((s, a) => s + a.valueUSD, 0);
    expect(totalValueUSD).toBeCloseTo(sum, 2);
  });
});
