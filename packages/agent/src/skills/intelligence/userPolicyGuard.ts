/**
 * userPolicyGuard
 *
 * Enforces user-defined policies on every agent action before execution.
 *
 * Supported constraints (stored in goal.policy_json):
 *   maxRiskLevel:           "low" | "medium" | "high"   — never execute if risk > this level
 *   allowedProtocols:       string[]                     — whitelist of protocols
 *   maxAllocationPerProtocol: Record<string, number>     — max % of portfolio in one protocol
 *   maxSingleTxValueUSD:    number                       — reject any single swap > this value
 *   requireProfitability:   boolean                      — hard-gate rebalance on profitability check
 *
 * All constraints are optional and additive.
 * An empty policy object = no restrictions (default, fully autonomous).
 *
 * This module is pure (no I/O) so it is easily unit-testable.
 */

import { logger } from "@piggy/shared";
import type { RiskLevel } from "../safety/riskScoringEngine.js";

// ── Types ─────────────────────────────────────────────────────────────────

export interface UserPolicy {
  /** Maximum acceptable risk level for any position or action */
  maxRiskLevel?: RiskLevel;

  /** Whitelist of allowed protocols (e.g. ["aave", "mento"]) */
  allowedProtocols?: string[];

  /**
   * Max percentage of total portfolio value in a single protocol.
   * Key = protocol name, value = max % (0–100).
   * E.g. { "uniswap": 20 } → never put more than 20% in Uniswap LP.
   */
  maxAllocationPerProtocol?: Record<string, number>;

  /** Max value in USD for any single swap transaction */
  maxSingleTxValueUSD?: number;

  /** If true, rebalance is blocked unless profitability check passes */
  requireProfitability?: boolean;
}

export interface PolicyCheckInput {
  /** The intended action (for logging) */
  action: string;

  /** Protocol being used for this action */
  protocol?: string;

  /** Risk score of this action/position */
  riskLevel?: RiskLevel;

  /** USD value of a single tx in this action */
  txValueUSD?: number;

  /** Current allocation as a percent of total portfolio (for max-alloc check) */
  protocolAllocationPct?: number;

  /** Whether the profitability check passed */
  isProfitable?: boolean;
}

export interface PolicyCheckResult {
  allowed:    boolean;
  violations: string[];
  reason:     string;
}

// ── Risk level ordering ────────────────────────────────────────────────────

const RISK_ORDER: RiskLevel[] = ["low", "medium", "high", "critical"];

function isRiskExceeded(actual: RiskLevel, max: RiskLevel): boolean {
  return RISK_ORDER.indexOf(actual) > RISK_ORDER.indexOf(max);
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Check whether an intended agent action complies with the user's policy.
 *
 * Returns `allowed: false` with a list of violations if any constraint is breached.
 * Returns `allowed: true` if no constraints are violated.
 *
 * @example
 * const policy: UserPolicy = { maxRiskLevel: "medium", allowedProtocols: ["aave", "mento"] };
 *
 * const check = checkUserPolicy(policy, {
 *   action:   "execute_rebalance",
 *   protocol: "uniswap",
 *   riskLevel: "high",
 * });
 * // check.allowed = false — Uniswap not in allowedProtocols AND risk too high
 */
export function checkUserPolicy(
  policy:  UserPolicy,
  input:   PolicyCheckInput,
): PolicyCheckResult {
  const violations: string[] = [];

  // ── Check 1: Max risk level ───────────────────────────────────────────
  if (policy.maxRiskLevel && input.riskLevel) {
    if (isRiskExceeded(input.riskLevel, policy.maxRiskLevel)) {
      violations.push(
        `Risk level "${input.riskLevel}" exceeds user maximum "${policy.maxRiskLevel}".`,
      );
    }
  }

  // ── Check 2: Allowed protocols ────────────────────────────────────────
  if (policy.allowedProtocols && policy.allowedProtocols.length > 0 && input.protocol) {
    if (!policy.allowedProtocols.includes(input.protocol)) {
      violations.push(
        `Protocol "${input.protocol}" is not in the user's allowed list: [${policy.allowedProtocols.join(", ")}].`,
      );
    }
  }

  // ── Check 3: Max allocation per protocol ─────────────────────────────
  if (
    policy.maxAllocationPerProtocol &&
    input.protocol &&
    input.protocolAllocationPct != null
  ) {
    const maxPct = policy.maxAllocationPerProtocol[input.protocol];
    if (maxPct != null && input.protocolAllocationPct > maxPct) {
      violations.push(
        `Allocation to "${input.protocol}" (${input.protocolAllocationPct.toFixed(1)}%) ` +
        `exceeds user maximum of ${maxPct}%.`,
      );
    }
  }

  // ── Check 4: Max single tx value ────────────────────────────────────
  if (policy.maxSingleTxValueUSD != null && input.txValueUSD != null) {
    if (input.txValueUSD > policy.maxSingleTxValueUSD) {
      violations.push(
        `Single tx value $${input.txValueUSD.toFixed(2)} exceeds user maximum ` +
        `$${policy.maxSingleTxValueUSD.toFixed(2)}.`,
      );
    }
  }

  // ── Check 5: Require profitability ───────────────────────────────────
  if (policy.requireProfitability && input.isProfitable === false) {
    violations.push(
      "User policy requires profitability check to pass before rebalancing.",
    );
  }

  const allowed = violations.length === 0;
  const reason  = allowed
    ? `Action "${input.action}" complies with user policy.`
    : `Action "${input.action}" blocked by user policy: ${violations.join(" | ")}`;

  if (!allowed) {
    logger.warn("userPolicyGuard: action blocked", {
      action:     input.action,
      violations,
    });
  } else {
    logger.info("userPolicyGuard: action allowed", { action: input.action });
  }

  return { allowed, violations, reason };
}

/**
 * Parse policy JSON from the DB (goal.policy_json).
 * Returns an empty policy (no restrictions) on parse failure.
 */
export function parseUserPolicy(policyJson: unknown): UserPolicy {
  if (!policyJson) return {};
  if (typeof policyJson === "object" && !Array.isArray(policyJson)) {
    return policyJson as UserPolicy;
  }
  if (typeof policyJson === "string") {
    try { return JSON.parse(policyJson) as UserPolicy; } catch { return {}; }
  }
  return {};
}
