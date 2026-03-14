/**
 * circuitBreaker
 *
 * Emergency pause system for the Piggy Sentinel agent.
 *
 * Triggers (any one is sufficient to trip the breaker):
 *   1. Stablecoin peg deviation exceeds PEG_CRITICAL_THRESHOLD_PCT
 *   2. Protocol risk score is "critical" (score ≥ 90)
 *   3. Price volatility spike (asset moves > VOLATILITY_SPIKE_PCT in 24h)
 *
 * When tripped:
 *   - Sets soft_paused = true for the affected goal via the DB
 *   - Emits a structured agentscan event
 *   - Queues a Telegram notification to the user
 *   - Returns a CircuitBreakerResult with the trigger reason
 *
 * Auto-reset:
 *   The breaker does NOT auto-reset.  The user must manually resume via
 *   POST /api/goals/:id/resume, which clears soft_paused after they have
 *   reviewed the situation.  This matches the non-custodial design where
 *   humans remain in control during abnormal conditions.
 */

import { logger }              from "@piggy/shared";
import { setSoftPausedByOwner, insertNotification, getTelegramChatId } from "@piggy/db";
import { emitAgentEvent }      from "@piggy/observability";
import type { RiskScore }      from "./riskScoringEngine.js";
import type { PegMonitorResult } from "./stablecoinPegMonitor.js";

// ── Types ─────────────────────────────────────────────────────────────────

export type CircuitBreakerTrigger =
  | "peg_deviation"
  | "critical_risk_score"
  | "volatility_spike"
  | "manual";

export interface CircuitBreakerInput {
  goalId:      string;
  userWallet:  string;
  agentWallet: string;

  /** Current peg monitor result (pass null to skip peg check) */
  pegResult?:   PegMonitorResult | null;

  /** Aggregated risk score (pass null to skip risk check) */
  riskScore?:   RiskScore | null;

  /**
   * 24h price volatility of the dominant asset in the portfolio (%).
   * Pass null to skip volatility check.
   */
  volatilityPct?: number | null;
}

export interface CircuitBreakerResult {
  /** Whether the circuit breaker was tripped */
  tripped:   boolean;
  trigger?:  CircuitBreakerTrigger;
  reason?:   string;
  /** Notification message sent to user (for logging) */
  message?:  string;
}

// ── Thresholds ────────────────────────────────────────────────────────────

const VOLATILITY_SPIKE_PCT = parseFloat(
  process.env.CIRCUIT_BREAKER_VOLATILITY_PCT ?? "15.0",
);

// ── Helpers ───────────────────────────────────────────────────────────────

function buildNotificationText(
  trigger: CircuitBreakerTrigger,
  reason:  string,
): string {
  const header = `🚨 *Piggy Sentinel — Emergency Pause*\n\n`;
  const body   = `Your savings agent has been automatically paused.\n\n*Reason:* ${reason}\n\n`;
  const action = `To review and resume, visit the Piggy Sentinel dashboard or send /resume to this bot.\n\n`;
  const footer = `_Your funds are safe. No further actions will be taken until you resume._`;
  return header + body + action + footer;
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Evaluate circuit breaker conditions.  If any trigger fires:
 *   1. Soft-pauses the goal in the DB
 *   2. Emits agentscan event
 *   3. Sends Telegram notification
 *
 * Returns immediately after first trigger (fail-fast).
 *
 * @example
 * const cb = await evaluateCircuitBreaker({
 *   goalId,
 *   userWallet,
 *   agentWallet,
 *   pegResult,
 *   riskScore,
 *   volatilityPct,
 * });
 * if (cb.tripped) return; // skip rest of cycle
 */
export async function evaluateCircuitBreaker(
  input: CircuitBreakerInput,
): Promise<CircuitBreakerResult> {
  let trigger: CircuitBreakerTrigger | null = null;
  let reason  = "";

  // ── Check 1: Peg deviation ──────────────────────────────────────────
  if (input.pegResult?.hasCritical) {
    const criticalReadings = input.pegResult.readings
      .filter(r => r.status === "critical")
      .map(r => `${r.token} $${r.priceUSD.toFixed(4)} (${r.deviationPct.toFixed(2)}% deviation)`)
      .join(", ");
    trigger = "peg_deviation";
    reason  = `Critical stablecoin depeg detected: ${criticalReadings}`;
  }

  // ── Check 2: Critical risk score ────────────────────────────────────
  if (!trigger && input.riskScore?.level === "critical") {
    trigger = "critical_risk_score";
    reason  = `Protocol risk score is critical: ${input.riskScore.score}/100. ` +
              `Dominant factor: ${input.riskScore.dominantFactor}.`;
  }

  // ── Check 3: Volatility spike ────────────────────────────────────────
  if (!trigger && input.volatilityPct != null && input.volatilityPct > VOLATILITY_SPIKE_PCT) {
    trigger = "volatility_spike";
    reason  = `Price volatility spike detected: ${input.volatilityPct.toFixed(1)}% exceeds ` +
              `${VOLATILITY_SPIKE_PCT}% threshold.`;
  }

  // ── No trigger — all clear ───────────────────────────────────────────
  if (!trigger) {
    logger.info("circuitBreaker: all checks passed", { goalId: input.goalId });
    return { tripped: false };
  }

  // ── Breaker tripped ──────────────────────────────────────────────────
  logger.error("circuitBreaker: TRIPPED", {
    goalId:  input.goalId,
    trigger,
    reason,
  });

  // 1. Soft-pause in DB
  try {
    await setSoftPausedByOwner(input.userWallet, true);
  } catch (err) {
    logger.error("circuitBreaker: failed to set soft_paused", err);
  }

  // 2. Agentscan event
  try {
    await emitAgentEvent({
      agentWalletAddress: input.agentWallet,
      skillName:          "circuitBreaker" as any,
      eventType:          "CIRCUIT_BREAKER_TRIPPED" as any,
      txHash:             null,
      metadata:           { goalId: input.goalId, trigger, reason },
    });
  } catch (err) {
    logger.error("circuitBreaker: failed to emit agentscan event", err);
  }

  // 3. Telegram notification
  const message = buildNotificationText(trigger, reason);
  try {
    const chatId = await getTelegramChatId(input.userWallet);
    if (chatId) {
      await insertNotification({
        goalId:         input.goalId,
        telegramChatId: chatId,
        type:           "circuit_breaker",
        messageText:    message,
      });
    }
  } catch (err) {
    logger.error("circuitBreaker: failed to send Telegram notification", err);
  }

  return { tripped: true, trigger, reason, message };
}
