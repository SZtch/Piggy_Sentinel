/**
 * Piggy Sentinel — Smart Top-Up Suggestions
 *
 * When the user is behind pace, compute the optimal one-time or recurring
 * top-up amount that would bring them back on track.
 *
 * Two modes:
 *   1. Catch-up now  — single lump-sum to restore expected trajectory
 *   2. Spread it out — extra monthly amount for remainder of goal
 *
 * Formula for lump-sum catch-up:
 *   lumpSum = expectedBalance − currentBalance
 *   (no yield adjustment since it's an immediate top-up)
 *
 * Formula for spread catch-up:
 *   FV_annuity(extraPMT, r, remainingMonths) = goalGap
 *   extraPMT = goalGap × r/12 / ((1+r/12)^n − 1)
 */

import type { PaceResult } from "./paceTracking.js";

export interface TopUpInput {
  paceResult:          PaceResult;
  goalAmount:          number;
  expectedAPY:         number;
  existingMonthlyDeposit: number;
}

export interface TopUpSuggestion {
  /** Is a top-up actually recommended? */
  recommended:         boolean;
  /** Recommended one-time lump sum to catch up immediately */
  catchUpLumpSum:      number;
  /** Recommended increase to monthly deposit for the rest of the goal */
  extraMonthlyDeposit: number;
  /** Current monthly (for display) */
  currentMonthly:      number;
  /** New total monthly after increase */
  newTotalMonthly:     number;
  /** Friendly message from Penny */
  message:             string;
}

function requiredPMT(targetFV: number, annualRate: number, months: number): number {
  if (targetFV <= 0 || months <= 0) return 0;
  if (annualRate === 0) return targetFV / months;
  const r = annualRate / 12;
  return targetFV * r / (Math.pow(1 + r, months) - 1);
}

function fmt(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Compute top-up suggestions when the user is behind pace.
 */
export function computeTopUpSuggestion(input: TopUpInput): TopUpSuggestion {
  const { paceResult, goalAmount, expectedAPY, existingMonthlyDeposit } = input;
  const { paceStatus, currentBalance, expectedBalance, monthsRemaining } = paceResult;

  // Only recommend top-ups when behind
  if (paceStatus !== "behind_pace") {
    return {
      recommended:         false,
      catchUpLumpSum:      0,
      extraMonthlyDeposit: 0,
      currentMonthly:      existingMonthlyDeposit,
      newTotalMonthly:     existingMonthlyDeposit,
      message:             "You're on track — no top-up needed right now. 👍",
    };
  }

  // Lump-sum to restore trajectory immediately
  const lumpSum = Math.max(0, expectedBalance - currentBalance);

  // Remaining gap to goal (factoring in yield on current balance)
  const remainingGoalGap = Math.max(0, goalAmount - currentBalance);
  const extraPMT         = requiredPMT(remainingGoalGap, expectedAPY, monthsRemaining)
                           - existingMonthlyDeposit;
  const extraMonthly     = Math.max(0, Math.ceil(extraPMT));  // round up to nearest dollar

  const newTotalMonthly  = existingMonthlyDeposit + extraMonthly;

  // Build message — always offer the simpler option first
  let message: string;
  if (lumpSum < 50) {
    // Small gap — just suggest the lump sum
    message = `You're ${fmt(Math.abs(paceResult.balanceDelta))} below expected trajectory. ` +
      `Adding ${fmt(lumpSum)} now would put you right back on track. 💡`;
  } else if (extraMonthly < 30) {
    // Gap is large but close — monthly approach is easy
    message = `You're slightly behind pace. Adding ${fmt(extraMonthly)}/month for the next ` +
      `${monthsRemaining} months would keep your goal on schedule. ` +
      `That's ${fmt(newTotalMonthly)}/month total.`;
  } else {
    // Offer both options
    message = `You're ${fmt(Math.abs(paceResult.balanceDelta))} below expected trajectory. ` +
      `Two options to get back on track:\n` +
      `• Top up ${fmt(lumpSum)} now, or\n` +
      `• Add ${fmt(extraMonthly)}/month for the remaining ${monthsRemaining} months (${fmt(newTotalMonthly)}/month total).`;
  }

  return {
    recommended:         true,
    catchUpLumpSum:      Math.round(lumpSum * 100) / 100,
    extraMonthlyDeposit: extraMonthly,
    currentMonthly:      existingMonthlyDeposit,
    newTotalMonthly,
    message,
  };
}
