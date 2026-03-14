/**
 * Piggy Sentinel — Goal Progress Engine
 *
 * Tracks what percentage of the goal has been reached, classifies
 * milestone events, projects finish date, and generates celebration
 * messages for Penny to deliver at key thresholds.
 */

export type Milestone = 25 | 50 | 75 | 100;

export interface ProgressInput {
  currentBalance:    number;
  goalAmount:        number;
  startingBalance:   number;
  goalStartDate:     Date;
  goalDeadline:      Date;
  expectedAPY:       number;
  monthlyDeposit:    number;
}

export interface ProgressResult {
  progressPercent:        number;
  currentBalance:         number;
  goalAmount:             number;
  amountRemaining:        number;
  milestonesHit:          Milestone[];
  /** Milestone just crossed in this cycle (null if none) */
  newMilestone:           Milestone | null;
  projectedFinishDate:    Date | null;
  /** Days ahead of deadline (positive = early, negative = late) */
  daysAheadOfDeadline:    number | null;
  isComplete:             boolean;
  message:                string;
}

function fmt(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Solve for t (months) given P, PMT, r, and target FV.
 * Uses Newton's method for the non-linear case.
 */
function monthsToReachTarget(
  currentBalance: number,
  monthlyDeposit: number,
  annualRate:     number,
  target:         number,
): number | null {
  if (currentBalance >= target) return 0;
  if (annualRate === 0 && monthlyDeposit <= 0) return null;

  const r = annualRate / 12;

  // Binary search: t in [0, 600] months (50 years)
  let lo = 0, hi = 600;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const fv  = currentBalance * Math.pow(1 + r, mid) +
                (r > 0 ? monthlyDeposit * ((Math.pow(1 + r, mid) - 1) / r) : monthlyDeposit * mid);
    if (fv < target) lo = mid;
    else              hi = mid;
  }
  return lo < 600 ? (lo + hi) / 2 : null;
}

const MILESTONES: Milestone[] = [25, 50, 75, 100];

/**
 * Compute goal progress and milestone status.
 */
export function computeGoalProgress(
  input: ProgressInput,
  previousProgressPercent = 0,
): ProgressResult {
  const {
    currentBalance, goalAmount, startingBalance,
    goalStartDate, goalDeadline, expectedAPY, monthlyDeposit,
  } = input;

  const progressPercent = Math.min(100, (currentBalance / goalAmount) * 100);
  const amountRemaining = Math.max(0, goalAmount - currentBalance);
  const isComplete      = progressPercent >= 100;

  // Which milestones have been crossed
  const milestonesHit = MILESTONES.filter(m => progressPercent >= m);

  // Did we cross a new milestone this cycle?
  const newMilestone = MILESTONES.find(
    m => progressPercent >= m && previousProgressPercent < m
  ) ?? null;

  // Projected finish date
  const monthsNeeded = monthsToReachTarget(currentBalance, monthlyDeposit, expectedAPY, goalAmount);
  const projectedFinishDate = monthsNeeded !== null
    ? new Date(Date.now() + monthsNeeded * 30.44 * 24 * 3_600_000)
    : null;

  // Days ahead / behind deadline
  const deadlineMs = goalDeadline.getTime();
  const daysAheadOfDeadline = projectedFinishDate !== null
    ? Math.round((deadlineMs - projectedFinishDate.getTime()) / 86_400_000)
    : null;

  // Build message
  let message: string;

  if (isComplete) {
    message = `🏆 Goal complete! You've saved ${fmt(currentBalance)} — your ${fmt(goalAmount)} target has been reached. ` +
      `Penny is returning all funds to your wallet.`;
  } else if (newMilestone === 75) {
    message = `🎉 75% reached! You've saved ${fmt(currentBalance)} of ${fmt(goalAmount)}. ` +
      `Only ${fmt(amountRemaining)} to go — you're in the home stretch! 💪`;
  } else if (newMilestone === 50) {
    message = `🎯 Halfway there! ${fmt(currentBalance)} saved of your ${fmt(goalAmount)} goal. ` +
      `${projectedFinishDate
        ? `At this pace, you'll reach your goal around ${projectedFinishDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}.`
        : "Keep going!"}`;
  } else if (newMilestone === 25) {
    message = `🐷 First milestone! You've hit 25% — ${fmt(currentBalance)} saved. ` +
      `${fmt(amountRemaining)} still to go. Penny keeps earning for you.`;
  } else {
    const pctStr = progressPercent.toFixed(1);
    const daysLeft = Math.max(0, Math.ceil((deadlineMs - Date.now()) / 86_400_000));
    message = `📊 Progress: ${pctStr}% — ${fmt(currentBalance)} of ${fmt(goalAmount)}. ` +
      `${fmt(amountRemaining)} remaining. ` +
      (daysLeft > 0 ? `${daysLeft} days until deadline.` : "");
  }

  return {
    progressPercent:     Math.round(progressPercent * 10) / 10,
    currentBalance:      Math.round(currentBalance * 100) / 100,
    goalAmount,
    amountRemaining:     Math.round(amountRemaining * 100) / 100,
    milestonesHit,
    newMilestone,
    projectedFinishDate,
    daysAheadOfDeadline,
    isComplete,
    message,
  };
}
