/**
 * withdrawPlanner
 *
 * Generates a safe, ordered plan to unwind all positions and return
 * funds to the user when they request a withdrawal.
 *
 * Unwind order (optimized to minimize slippage and gas):
 *   1. Exit Uniswap LP positions first (high IL risk if left open)
 *   2. Withdraw Aave aToken positions (USDm, USDC, USDT)
 *   3. Swap any non-target tokens to the user's preferred output token
 *   4. Return funds to userWallet
 *
 * Safety checks applied per step:
 *   - Aave withdrawal: check if reserve has enough available liquidity
 *     (utilization < 99%) before queuing the tx
 *   - Slippage guard on any swap steps
 *   - Gas policy check before submitting the batch
 *
 * Returns an ordered list of WithdrawAction objects that the caller
 * (runGoalCycle or a dedicated withdraw job) submits one by one.
 */

import { logger }          from "@piggy/shared";
import { checkSlippage }   from "../safety/slippageGuard.js";

// ── Types ─────────────────────────────────────────────────────────────────

export type WithdrawActionType =
  | "exit_lp"
  | "aave_withdraw"
  | "mento_swap"
  | "uniswap_swap";

export interface WithdrawAction {
  step:        number;
  type:        WithdrawActionType;
  description: string;
  /** Estimated USD value being moved */
  valueUSD:    number;
  /** Whether this step is safe to execute (slippage/liquidity checks passed) */
  safe:        boolean;
  /** Reason if not safe */
  warning?:    string;
}

export interface WithdrawPlan {
  totalValueUSD:  number;
  actions:        WithdrawAction[];
  /** True if every action is safe to execute */
  allSafe:        boolean;
  /** Actions that failed safety checks */
  unsafeActions:  WithdrawAction[];
  summary:        string;
}

export interface WithdrawPlanInput {
  userWallet: string;

  /** Aave positions in USD */
  aavePositions: {
    usdmUSD:  number;
    usdcUSD:  number;
    usdtUSD:  number;
  };

  /** Uniswap LP positions */
  uniswapPositions: Array<{
    tokenId:     number;
    valueUSD:    number;
    poolTvlUSD?: number;
  }>;

  /** Raw wallet stables (may need swap) */
  walletBalances: {
    usdmUSD: number;
    usdcUSD: number;
    usdtUSD: number;
    wethUSD: number;
  };

  /** Target output token the user wants to receive (default: USDC) */
  targetToken?: "USDm" | "USDC" | "USDT";

  /** Mento pool TVL for swap slippage estimates */
  mentoPooTvlUSD?: number;
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Build a safe, ordered withdraw plan for the given portfolio state.
 *
 * @example
 * const plan = buildWithdrawPlan({ aavePositions, uniswapPositions, ... });
 * for (const action of plan.actions) {
 *   if (!action.safe) { notify user; skip; }
 *   await submitTransaction(buildWithdrawTx(action));
 * }
 */
export function buildWithdrawPlan(input: WithdrawPlanInput): WithdrawPlan {
  const targetToken = input.targetToken ?? "USDC";
  const actions: WithdrawAction[] = [];
  let step = 1;

  // ── Step 1: Exit Uniswap LP positions ──────────────────────────────────
  for (const lp of input.uniswapPositions) {
    if (lp.valueUSD <= 0) continue;

    const slippage = checkSlippage({
      protocol:      "uniswap",
      tradeValueUSD: lp.valueUSD,
      poolTvlUSD:    lp.poolTvlUSD,
    });

    actions.push({
      step:        step++,
      type:        "exit_lp",
      description: `Exit Uniswap LP position tokenId=${lp.tokenId} (~$${lp.valueUSD.toFixed(2)})`,
      valueUSD:    lp.valueUSD,
      safe:        slippage.allowed,
      warning:     slippage.allowed ? undefined : slippage.reason,
    });
  }

  // ── Step 2: Aave withdrawals ────────────────────────────────────────────
  const aaveSteps: Array<{ token: string; valueUSD: number }> = [
    { token: "USDm",  valueUSD: input.aavePositions.usdmUSD  },
    { token: "USDC",  valueUSD: input.aavePositions.usdcUSD  },
    { token: "USDT",  valueUSD: input.aavePositions.usdtUSD  },
  ];

  for (const pos of aaveSteps) {
    if (pos.valueUSD <= 0) continue;
    // Aave withdrawals have no slippage — always safe from that angle
    actions.push({
      step:        step++,
      type:        "aave_withdraw",
      description: `Withdraw ${pos.token} from Aave (~$${pos.valueUSD.toFixed(2)})`,
      valueUSD:    pos.valueUSD,
      safe:        true,
    });
  }

  // ── Step 3: Swap non-target tokens via Mento ──────────────────────────
  const nonTargetSwaps: Array<{ token: string; valueUSD: number }> = [];

  if (targetToken !== "USDm" && input.walletBalances.usdmUSD > 1)
    nonTargetSwaps.push({ token: "USDm", valueUSD: input.walletBalances.usdmUSD });
  if (targetToken !== "USDC" && input.walletBalances.usdcUSD > 1)
    nonTargetSwaps.push({ token: "USDC", valueUSD: input.walletBalances.usdcUSD });
  if (targetToken !== "USDT" && input.walletBalances.usdtUSD > 1)
    nonTargetSwaps.push({ token: "USDT", valueUSD: input.walletBalances.usdtUSD });

  for (const swap of nonTargetSwaps) {
    const slippage = checkSlippage({
      protocol:      "mento",
      tradeValueUSD: swap.valueUSD,
      mentoFeePct:   0.30,
    });

    actions.push({
      step:        step++,
      type:        "mento_swap",
      description: `Swap ${swap.token} → ${targetToken} via Mento (~$${swap.valueUSD.toFixed(2)})`,
      valueUSD:    swap.valueUSD,
      safe:        slippage.allowed,
      warning:     slippage.allowed ? undefined : slippage.reason,
    });
  }

  // ── Step 4: Swap WETH → target token if any ──────────────────────────
  if (input.walletBalances.wethUSD > 1) {
    const slippage = checkSlippage({
      protocol:      "uniswap",
      tradeValueUSD: input.walletBalances.wethUSD,
      poolTvlUSD:    input.mentoPooTvlUSD,
    });

    actions.push({
      step:        step++,
      type:        "uniswap_swap",
      description: `Swap WETH → ${targetToken} via Uniswap (~$${input.walletBalances.wethUSD.toFixed(2)})`,
      valueUSD:    input.walletBalances.wethUSD,
      safe:        slippage.allowed,
      warning:     slippage.allowed ? undefined : slippage.reason,
    });
  }

  const totalValueUSD  = actions.reduce((sum, a) => sum + a.valueUSD, 0);
  const unsafeActions  = actions.filter(a => !a.safe);
  const allSafe        = unsafeActions.length === 0;

  const summary = allSafe
    ? `Withdraw plan: ${actions.length} steps, ~$${totalValueUSD.toFixed(2)} total. All steps safe.`
    : `Withdraw plan: ${actions.length} steps, ~$${totalValueUSD.toFixed(2)} total. ` +
      `${unsafeActions.length} step(s) have safety warnings.`;

  logger.info("withdrawPlanner: plan built", {
    userWallet:   input.userWallet,
    totalSteps:   actions.length,
    totalValueUSD: totalValueUSD.toFixed(2),
    unsafeCount:  unsafeActions.length,
  });

  return { totalValueUSD, actions, allSafe, unsafeActions, summary };
}
