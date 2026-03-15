// ─────────────────────────────────────────────────────────────────────────────
// @piggy/agent — Decision Engine
//
// Determines whether the agent should execute a rebalance this cycle.
// All guardrails are checked here before any on-chain action is taken.
//
// DEMO_MODE: set DEMO_MODE=true di .env untuk bypass gas/amount guardrails.
// Berguna untuk demo hackathon dengan portfolio kecil ($10).
// Jangan aktifkan di production.
// ─────────────────────────────────────────────────────────────────────────────

const DEMO_MODE = process.env.DEMO_MODE === "true";

import type { AgentDecision } from "@piggy/shared";
import {
  BLENDED_APY_PCT,
  APY_CHANGE_THRESHOLD_PCT,
  MIN_REBALANCE_AMOUNT,
  MAX_REBALANCE_INTERVAL_MS,
  MAX_GAS_TO_YIELD_RATIO_PCT,
  ALLOC_USDT_BPS,
  ALLOC_USDC_BPS,
  ALLOC_USDM_BPS,
} from "@piggy/shared";
import type { RiskScore } from "./skills/safety/riskScoringEngine.js";
import type { SystemHealthResult } from "./skills/intelligence/protocolHealthMonitor.js";

export interface DecisionInput {
  goalId:           string;
  userWallet:       string;
  softPaused:       boolean;
  goalStatus:       string;
  lastRebalancedAt: Date | null;
  /** APY saat rebalance terakhir — untuk hitung drift akurat */
  lastBlendedApy?:  number;
  portfolio: {
    stableUSD: number;
    lpUSD:     number;
    wethUSD:   number;
    totalUSD:  number;
  };
  apys: {
    usdt: number;
    usdc: number;
    usdm: number;
  };
  estimatedGasUSD: number;
  /**
   * Aggregated risk score from riskScoringEngine.
   * When level is "high" or "critical", execution is blocked.
   * Pass undefined to skip risk-based guardrails (e.g. first-run before safety stack is warm).
   */
  riskScore?: RiskScore;
  /**
   * Protocol health from protocolHealthMonitor.
   * When any protocol is "degraded", agent is cautious but still executes.
   * "unavailable" is handled upstream before makeDecision is called.
   */
  protocolHealth?: SystemHealthResult;
}

/**
 * Core decision logic — pure function, no side effects.
 *
 * Guardrails (any failure → skip):
 *   1. Not soft-paused
 *   2. Portfolio >= MIN_REBALANCE_AMOUNT
 *   3. Not rebalanced in last 24h (unless first alloc)
 *   4. APY drift > APY_CHANGE_THRESHOLD_PCT from current blended
 *   5. Gas cost < MAX_GAS_TO_YIELD_RATIO_PCT % of annual yield
 */
export function makeDecision(input: DecisionInput): AgentDecision {
  const { softPaused, portfolio, apys, lastRebalancedAt, estimatedGasUSD } = input;

  // ── DEMO MODE: bypass semua guardrail kecuali paused ─────────────────────
  // Aktifkan dengan DEMO_MODE=true di .env — untuk demo dengan portfolio kecil.
  // Tetap blokir kalau goal di-pause agar user control tetap dihormati.
  if (DEMO_MODE && !softPaused && input.goalStatus !== "paused") {
    const newBlended = computeBlended(apys);
    return execute(
      "execute_rebalance",
      portfolio.lpUSD > 0 ? "lp" : "stable",
      newBlended,
      `[DEMO MODE] bypassing guardrails — blended APY ${newBlended.toFixed(2)}%`,
    );
  }

  // ── Guardrail 1: paused ────────────────────────────────────────────────────
  if (softPaused || input.goalStatus === "paused") {
    return skip("skip_paused", "goal is soft-paused", BLENDED_APY_PCT);
  }

  // ── Guardrail 2: minimum portfolio value ──────────────────────────────────
  if (portfolio.totalUSD < MIN_REBALANCE_AMOUNT) {
    return skip(
      "skip_min_amount",
      `portfolio $${portfolio.totalUSD.toFixed(2)} < min $${MIN_REBALANCE_AMOUNT}`,
      BLENDED_APY_PCT,
    );
  }

  // ── First allocation (never rebalanced) ───────────────────────────────────
  if (!lastRebalancedAt) {
    const newBlended = computeBlended(apys);
    return execute("execute_initial_alloc", "stable", newBlended, "first allocation");
  }

  // ── Guardrail 3: frequency 24h ────────────────────────────────────────────
  const msSince = Date.now() - lastRebalancedAt.getTime();
  if (msSince < MAX_REBALANCE_INTERVAL_MS) {
    const hoursLeft = Math.ceil((MAX_REBALANCE_INTERVAL_MS - msSince) / 3_600_000);
    return skip("skip_frequency", `next rebalance in ${hoursLeft}h`, BLENDED_APY_PCT);
  }

  // ── Current blended APY ────────────────────────────────────────────────────
  // ── Current blended APY ────────────────────────────────────────────────────
  // Pakai APY saat rebalance terakhir kalau ada — ini yang benar untuk drift calc.
  // Fallback ke BLENDED_APY_PCT (6.22%) hanya untuk cycle pertama.
  const currentBlended = input.lastBlendedApy ?? BLENDED_APY_PCT;
  const newBlended     = computeBlended(apys);
  const apyDrift       = Math.abs(newBlended - currentBlended);

  // ── Guardrail 4: APY drift threshold ─────────────────────────────────────
  if (apyDrift < APY_CHANGE_THRESHOLD_PCT) {
    return skip(
      "skip_no_change",
      `APY drift ${apyDrift.toFixed(2)}% < threshold ${APY_CHANGE_THRESHOLD_PCT}%`,
      newBlended,
    );
  }

  // ── Guardrail 5: gas cost vs yield ────────────────────────────────────────
  const annualYieldUSD    = portfolio.totalUSD * (newBlended / 100);
  const gasToYieldRatioPct = estimatedGasUSD / (annualYieldUSD / 365) * 100;

  if (gasToYieldRatioPct > MAX_GAS_TO_YIELD_RATIO_PCT) {
    return skip(
      "skip_gas_cost",
      `gas/yield ratio ${gasToYieldRatioPct.toFixed(1)}% > max ${MAX_GAS_TO_YIELD_RATIO_PCT}%`,
      newBlended,
    );
  }

  // ── Guardrail 6: risk score too high ──────────────────────────────────────
  // If the aggregated risk score is HIGH or CRITICAL, do not rebalance.
  // CRITICAL is already handled upstream (circuit breaker trips before we get here),
  // but we guard here as a second line of defence.
  if (input.riskScore && (input.riskScore.level === "high" || input.riskScore.level === "critical")) {
    return skip(
      "skip_high_risk",
      `Risk score ${input.riskScore.score}/100 (${input.riskScore.level}) — dominant factor: ${input.riskScore.dominantFactor}. Holding steady.`,
      newBlended,
    );
  }

  // ── Guardrail 7: protocol degraded ───────────────────────────────────────
  // If any protocol is degraded (but not unavailable — that's caught upstream),
  // skip rebalancing to avoid executing into a weakened market.
  if (input.protocolHealth?.hasDegraded) {
    const degradedProtocols = [
      input.protocolHealth.aave.status    === "degraded" ? "Aave"    : null,
      input.protocolHealth.mento.status   === "degraded" ? "Mento"   : null,
      input.protocolHealth.uniswap.status === "degraded" ? "Uniswap" : null,
    ].filter(Boolean).join(", ");
    return skip(
      "skip_protocol_degraded",
      `Protocol(s) degraded: ${degradedProtocols}. Skipping rebalance until health is restored.`,
      newBlended,
    );
  }

  // ── All guardrails passed — execute rebalance ─────────────────────────────
  const tier = portfolio.lpUSD > 0 ? "lp" : "stable";
  return execute(
    "execute_rebalance",
    tier,
    newBlended,
    `APY drift ${apyDrift.toFixed(2)}% — rebalancing from ${currentBlended.toFixed(2)}% → ${newBlended.toFixed(2)}%`,
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeBlended(apys: { usdt: number; usdc: number; usdm: number }): number {
  return (
    apys.usdt * (ALLOC_USDT_BPS / 10_000) +
    apys.usdc * (ALLOC_USDC_BPS / 10_000) +
    apys.usdm * (ALLOC_USDM_BPS / 10_000)
  );
}

function skip(
  action:  AgentDecision["action"],
  reason:  string,
  estApy:  number,
): AgentDecision {
  return { action, tier: "stable", reason, estimatedNewApy: estApy, shouldNotify: false };
}

function execute(
  action:  AgentDecision["action"],
  tier:    AgentDecision["tier"],
  estApy:  number,
  reason:  string,
): AgentDecision {
  return { action, tier, reason, estimatedNewApy: estApy, shouldNotify: true };
}