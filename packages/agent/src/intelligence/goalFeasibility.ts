/**
 * Piggy Sentinel — Goal Feasibility Engine
 *
 * Given the user's current balance, goal amount, time horizon, and
 * expected APY, determine whether the goal is achievable and how
 * much additional monthly deposit (if any) is required.
 *
 * Formula: FV = P × (1 + r)^t
 *   P = currentBalance
 *   r = expectedAPY (annual, decimal)
 *   t = years
 *
 * Monthly deposit component uses future value of annuity:
 *   FV_annuity = PMT × [((1+r/12)^n − 1) / (r/12)]
 *   PMT = (goalGap × r/12) / ((1 + r/12)^n − 1)
 */

export interface FeasibilityInput {
  /** Current balance in USD */
  currentBalance:       number;
  /** Savings target in USD */
  goalAmount:           number;
  /** Time horizon in months */
  timeHorizonMonths:    number;
  /** Expected blended APY as decimal (e.g. 0.0622 for 6.22%) */
  expectedAPY:          number;
  /** Optional additional monthly deposit user has committed */
  plannedMonthlyDeposit?: number;
}

export interface FeasibilityResult {
  /** FV of current balance alone, with compound interest */
  projectedValueFromBalance: number;
  /** FV including planned monthly deposits */
  projectedValueTotal:       number;
  /** How far short the projection is from the goal (0 if achievable) */
  goalGap:                   number;
  /** Extra monthly deposit needed to close the gap (0 if already achievable) */
  requiredMonthlyDeposit:    number;
  /** Whether the goal is reachable without any additional deposits */
  achievableWithBalance:     boolean;
  /** Whether the goal is reachable with the planned monthly deposit */
  achievableWithPlan:        boolean;
  /** Structured message Penny can send to the user */
  message:                   string;
  /** Short verdict for UI badges */
  verdict:                   "on_track" | "needs_deposits" | "needs_more_deposits" | "unreachable";
}

/**
 * Future value of a lump sum with compound interest (compounded monthly).
 */
function fvLumpSum(principal: number, annualRate: number, months: number): number {
  if (annualRate === 0) return principal;
  const r = annualRate / 12;
  return principal * Math.pow(1 + r, months);
}

/**
 * Future value of an ordinary annuity (monthly payments, compounded monthly).
 */
function fvAnnuity(monthlyPayment: number, annualRate: number, months: number): number {
  if (monthlyPayment <= 0) return 0;
  if (annualRate === 0)    return monthlyPayment * months;
  const r = annualRate / 12;
  return monthlyPayment * ((Math.pow(1 + r, months) - 1) / r);
}

/**
 * Monthly payment required to accumulate a target future value.
 * Solves PMT from FV_annuity equation.
 */
function requiredPMT(targetFV: number, annualRate: number, months: number): number {
  if (targetFV <= 0) return 0;
  if (annualRate === 0) return targetFV / months;
  const r = annualRate / 12;
  return targetFV * r / (Math.pow(1 + r, months) - 1);
}

function fmt(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Run feasibility analysis and return financial planning feedback.
 */
export function analyzeGoalFeasibility(input: FeasibilityInput): FeasibilityResult {
  const {
    currentBalance, goalAmount, timeHorizonMonths,
    expectedAPY, plannedMonthlyDeposit = 0,
  } = input;

  const projectedFromBalance = fvLumpSum(currentBalance, expectedAPY, timeHorizonMonths);
  const projectedFromDeposits = fvAnnuity(plannedMonthlyDeposit, expectedAPY, timeHorizonMonths);
  const projectedTotal = projectedFromBalance + projectedFromDeposits;

  const gapFromBalance = Math.max(0, goalAmount - projectedFromBalance);
  const gapFromPlan    = Math.max(0, goalAmount - projectedTotal);

  const achievableWithBalance = projectedFromBalance >= goalAmount;
  const achievableWithPlan    = projectedTotal >= goalAmount;

  // Required extra monthly PMT to close remaining gap
  const requiredExtra = achievableWithPlan
    ? 0
    : requiredPMT(gapFromPlan, expectedAPY, timeHorizonMonths);

  const requiredMonthlyDeposit = achievableWithBalance
    ? 0
    : Math.max(0, requiredPMT(gapFromBalance, expectedAPY, timeHorizonMonths));

  // Build message
  const months        = timeHorizonMonths;
  const apyPct        = (expectedAPY * 100).toFixed(1);
  let message: string;
  let verdict: FeasibilityResult["verdict"];

  if (achievableWithBalance) {
    message = `Great news — with your current balance of ${fmt(currentBalance)} and ~${apyPct}% APY, ` +
      `you're projected to reach ${fmt(projectedFromBalance)} in ${months} months. ` +
      `Your goal of ${fmt(goalAmount)} is fully covered by yield alone. 🎉`;
    verdict = "on_track";
  } else if (achievableWithPlan) {
    message = `With your current balance of ${fmt(currentBalance)}, yield alone would get you to ` +
      `${fmt(projectedFromBalance)} in ${months} months — ${fmt(gapFromBalance)} short of your goal. ` +
      `With your planned deposit of ${fmt(plannedMonthlyDeposit)}/month, you'd reach ${fmt(projectedTotal)}. ` +
      `You're on track. ✓`;
    verdict = "needs_deposits";
  } else if (gapFromPlan < goalAmount * 0.5) {
    // Gap is <50% of goal — achievable with moderate top-up
    const totalRequired = plannedMonthlyDeposit + requiredExtra;
    message = `With your current balance of ${fmt(currentBalance)} and ~${apyPct}% APY, ` +
      `you're projected to reach about ${fmt(projectedTotal)} in ${months} months — ` +
      `${fmt(gapFromPlan)} short of your ${fmt(goalAmount)} goal. ` +
      `To reach your target, you need to add around ${fmt(totalRequired)}/month.`;
    verdict = "needs_more_deposits";
  } else {
    message = `Your goal of ${fmt(goalAmount)} in ${months} months is ambitious. ` +
      `With ${fmt(currentBalance)} and ~${apyPct}% APY, you'd project ${fmt(projectedFromBalance)}. ` +
      `You would need to deposit around ${fmt(requiredMonthlyDeposit)}/month to bridge the gap. ` +
      `Consider extending your timeline or adjusting your target.`;
    verdict = "unreachable";
  }

  return {
    projectedValueFromBalance: Math.round(projectedFromBalance * 100) / 100,
    projectedValueTotal:       Math.round(projectedTotal * 100) / 100,
    goalGap:                   Math.round(gapFromBalance * 100) / 100,
    requiredMonthlyDeposit:    Math.round(requiredMonthlyDeposit * 100) / 100,
    achievableWithBalance,
    achievableWithPlan,
    message,
    verdict,
  };
}
