/**
 * Piggy Sentinel — Pace Tracking Engine
 *
 * Compares current balance against where the user should be at this point
 * in time to reach their goal, accounting for compound yield.
 *
 * Expected balance at time T uses the same FV formula as feasibility:
 *   expectedBalance = P₀ × (1 + r/12)^elapsed + PMT × [((1+r/12)^elapsed − 1) / (r/12)]
 *
 * Thresholds:
 *   ahead_of_pace   → currentBalance > expectedBalance × 1.05
 *   on_track        → within ±5% of expected
 *   behind_pace     → currentBalance < expectedBalance × 0.95
 */

export type PaceStatus = "ahead_of_pace" | "on_track" | "behind_pace";

export interface PaceInput {
  /** Current balance in USD */
  currentBalance:      number;
  /** Balance at goal activation (principal) in USD */
  startingBalance:     number;
  /** Savings target in USD */
  goalAmount:          number;
  /** Months elapsed since goal activation */
  monthsElapsed:       number;
  /** Total goal duration in months */
  totalMonths:         number;
  /** Expected blended APY as decimal */
  expectedAPY:         number;
  /** Monthly deposit committed (0 if none) */
  monthlyDeposit:      number;
}

export interface PaceResult {
  paceStatus:             PaceStatus;
  currentBalance:         number;
  expectedBalance:        number;
  /** Positive = ahead, negative = behind */
  balanceDelta:           number;
  /** As percentage of expected balance */
  deltaPercent:           number;
  progressPercent:        number;
  monthsRemaining:        number;
  /** Concise message for Penny to deliver */
  message:                string;
}

function fvLumpSum(p: number, annualRate: number, months: number): number {
  if (annualRate === 0) return p;
  const r = annualRate / 12;
  return p * Math.pow(1 + r, months);
}

function fvAnnuity(pmt: number, annualRate: number, months: number): number {
  if (pmt <= 0 || months <= 0) return 0;
  if (annualRate === 0) return pmt * months;
  const r = annualRate / 12;
  return pmt * ((Math.pow(1 + r, months) - 1) / r);
}

function fmt(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Determine pace status against expected trajectory.
 */
export function trackPace(input: PaceInput): PaceResult {
  const {
    currentBalance, startingBalance, goalAmount,
    monthsElapsed, totalMonths, expectedAPY, monthlyDeposit,
  } = input;

  // Expected balance right now if everything was on track
  const expectedBalance =
    fvLumpSum(startingBalance, expectedAPY, monthsElapsed) +
    fvAnnuity(monthlyDeposit, expectedAPY, monthsElapsed);

  const balanceDelta   = currentBalance - expectedBalance;
  const deltaPercent   = expectedBalance > 0
    ? (balanceDelta / expectedBalance) * 100
    : 0;

  const progressPercent = Math.min(100, (currentBalance / goalAmount) * 100);
  const monthsRemaining = Math.max(0, totalMonths - monthsElapsed);

  // Classify: ±5% band = on_track
  let paceStatus: PaceStatus;
  if (deltaPercent > 5)        paceStatus = "ahead_of_pace";
  else if (deltaPercent < -5)  paceStatus = "behind_pace";
  else                         paceStatus = "on_track";

  // Build message
  let message: string;
  const progressStr = progressPercent.toFixed(1);
  const remaining   = monthsRemaining === 1 ? "1 month" : `${monthsRemaining} months`;

  if (paceStatus === "ahead_of_pace") {
    message = `You're ahead of pace — ${fmt(currentBalance)} vs ${fmt(expectedBalance)} expected at this point. ` +
      `${progressStr}% complete with ${remaining} to go. Keep it up! 🚀`;
  } else if (paceStatus === "on_track") {
    message = `You're on track — ${fmt(currentBalance)} vs ${fmt(expectedBalance)} expected. ` +
      `${progressStr}% complete with ${remaining} remaining. ✓`;
  } else {
    const gap = Math.abs(balanceDelta);
    message = `You're slightly behind your goal pace — ${fmt(currentBalance)} vs ` +
      `${fmt(expectedBalance)} expected at this stage (${fmt(gap)} below target trajectory). ` +
      `${progressStr}% complete with ${remaining} remaining.`;
  }

  return {
    paceStatus,
    currentBalance:   Math.round(currentBalance * 100) / 100,
    expectedBalance:  Math.round(expectedBalance * 100) / 100,
    balanceDelta:     Math.round(balanceDelta * 100) / 100,
    deltaPercent:     Math.round(deltaPercent * 10) / 10,
    progressPercent:  Math.round(progressPercent * 10) / 10,
    monthsRemaining,
    message,
  };
}
