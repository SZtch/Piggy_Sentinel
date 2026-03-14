import type { SkillResult } from "@piggy/shared";
import { logger } from "@piggy/shared";
import type { CheckProgressInput, CheckProgressOutput } from "./types.js";

export async function checkGoalProgress(input: CheckProgressInput): Promise<SkillResult<CheckProgressOutput>> {
  const { goalTargetAmount, goalCurrency, deadlineDays, agentWalletAddress } = input;
  try {
    const currentBalance = 0n;
    const progressPct = goalTargetAmount > 0n ? Number((currentBalance * 10_000n) / goalTargetAmount) / 100 : 0;
    const expectedPct = deadlineDays > 0 ? (1 / deadlineDays) * 100 : 100;
    const paceStatus = progressPct >= expectedPct * 1.05 ? "ahead" : progressPct >= expectedPct * 0.95 ? "on_track" : "behind";
    const projectedValueAtDeadline = deadlineDays > 0 && progressPct > 0 ? currentBalance * BigInt(Math.round(100 / progressPct)) : 0n;
    const shouldAlert = paceStatus === "behind" && progressPct < expectedPct * 0.8;
    logger.info("checkGoalProgress", { agentWalletAddress, goalCurrency, paceStatus });
    return { success: true, data: { currentBalance, progressPct, paceStatus, projectedValueAtDeadline, shouldAlert }, error: null, txHash: null, agentscanEventId: null, executedAt: new Date() };
  } catch (err) {
    return { success: false, data: null, error: err instanceof Error ? err.message : String(err), txHash: null, agentscanEventId: null, executedAt: new Date() };
  }
}
