/**
 * userPolicyGuard.test.ts
 *
 * userPolicyGuard and parseUserPolicy are both pure (no I/O).
 * Tests cover all five constraint types plus the parser utility.
 */

import { describe, it, expect } from "vitest";
import { checkUserPolicy, parseUserPolicy, type UserPolicy } from "../userPolicyGuard.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

const BASE_ACTION = { action: "execute_rebalance" };

// ── Empty policy (fully autonomous) ──────────────────────────────────────

describe("checkUserPolicy: empty policy", () => {
  it("allows everything when policy is empty", () => {
    const result = checkUserPolicy({}, {
      ...BASE_ACTION,
      protocol:              "uniswap",
      riskLevel:             "critical",
      txValueUSD:            999_999,
      protocolAllocationPct: 100,
      isProfitable:          false,
    });
    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});

// ── maxRiskLevel ──────────────────────────────────────────────────────────

describe("checkUserPolicy: maxRiskLevel", () => {
  const policy: UserPolicy = { maxRiskLevel: "medium" };

  it("allows action when risk is at or below max", () => {
    expect(checkUserPolicy(policy, { ...BASE_ACTION, riskLevel: "low"    }).allowed).toBe(true);
    expect(checkUserPolicy(policy, { ...BASE_ACTION, riskLevel: "medium" }).allowed).toBe(true);
  });

  it("blocks action when risk exceeds max", () => {
    const high = checkUserPolicy(policy, { ...BASE_ACTION, riskLevel: "high" });
    expect(high.allowed).toBe(false);
    expect(high.violations[0]).toMatch(/"high" exceeds user maximum "medium"/);

    const critical = checkUserPolicy(policy, { ...BASE_ACTION, riskLevel: "critical" });
    expect(critical.allowed).toBe(false);
  });

  it("skips check when riskLevel is not provided", () => {
    const result = checkUserPolicy(policy, { ...BASE_ACTION });
    expect(result.allowed).toBe(true);
  });
});

// ── allowedProtocols ──────────────────────────────────────────────────────

describe("checkUserPolicy: allowedProtocols", () => {
  const policy: UserPolicy = { allowedProtocols: ["aave", "mento"] };

  it("allows protocol that is in the whitelist", () => {
    expect(checkUserPolicy(policy, { ...BASE_ACTION, protocol: "aave"  }).allowed).toBe(true);
    expect(checkUserPolicy(policy, { ...BASE_ACTION, protocol: "mento" }).allowed).toBe(true);
  });

  it("blocks protocol not in the whitelist", () => {
    const result = checkUserPolicy(policy, { ...BASE_ACTION, protocol: "uniswap" });
    expect(result.allowed).toBe(false);
    expect(result.violations[0]).toMatch(/"uniswap" is not in the user's allowed list/);
  });

  it("skips check when protocol is not provided", () => {
    const result = checkUserPolicy(policy, { ...BASE_ACTION });
    expect(result.allowed).toBe(true);
  });

  it("skips check when allowedProtocols list is empty", () => {
    const result = checkUserPolicy({ allowedProtocols: [] }, { ...BASE_ACTION, protocol: "uniswap" });
    expect(result.allowed).toBe(true);
  });
});

// ── maxAllocationPerProtocol ───────────────────────────────────────────────

describe("checkUserPolicy: maxAllocationPerProtocol", () => {
  const policy: UserPolicy = {
    maxAllocationPerProtocol: { uniswap: 20, aave: 80 },
  };

  it("allows when allocation is within per-protocol cap", () => {
    expect(checkUserPolicy(policy, { ...BASE_ACTION, protocol: "uniswap", protocolAllocationPct: 15 }).allowed).toBe(true);
    expect(checkUserPolicy(policy, { ...BASE_ACTION, protocol: "aave",    protocolAllocationPct: 79 }).allowed).toBe(true);
  });

  it("blocks when allocation exceeds per-protocol cap", () => {
    const result = checkUserPolicy(policy, { ...BASE_ACTION, protocol: "uniswap", protocolAllocationPct: 25 });
    expect(result.allowed).toBe(false);
    expect(result.violations[0]).toMatch(/25.0%.*exceeds.*20%/);
  });

  it("skips check when protocolAllocationPct is not provided", () => {
    const result = checkUserPolicy(policy, { ...BASE_ACTION, protocol: "uniswap" });
    expect(result.allowed).toBe(true);
  });
});

// ── maxSingleTxValueUSD ───────────────────────────────────────────────────

describe("checkUserPolicy: maxSingleTxValueUSD", () => {
  const policy: UserPolicy = { maxSingleTxValueUSD: 1000 };

  it("allows tx below the limit", () => {
    expect(checkUserPolicy(policy, { ...BASE_ACTION, txValueUSD: 999 }).allowed).toBe(true);
    expect(checkUserPolicy(policy, { ...BASE_ACTION, txValueUSD: 1000 }).allowed).toBe(true);
  });

  it("blocks tx above the limit", () => {
    const result = checkUserPolicy(policy, { ...BASE_ACTION, txValueUSD: 1001 });
    expect(result.allowed).toBe(false);
    expect(result.violations[0]).toMatch(/1001.00.*exceeds.*1000.00/);
  });
});

// ── requireProfitability ──────────────────────────────────────────────────

describe("checkUserPolicy: requireProfitability", () => {
  const policy: UserPolicy = { requireProfitability: true };

  it("allows when isProfitable is true", () => {
    expect(checkUserPolicy(policy, { ...BASE_ACTION, isProfitable: true }).allowed).toBe(true);
  });

  it("blocks when isProfitable is false", () => {
    const result = checkUserPolicy(policy, { ...BASE_ACTION, isProfitable: false });
    expect(result.allowed).toBe(false);
    expect(result.violations[0]).toMatch(/profitability check/i);
  });

  it("skips check when isProfitable is not provided", () => {
    const result = checkUserPolicy(policy, { ...BASE_ACTION });
    expect(result.allowed).toBe(true);
  });
});

// ── Multiple violations ────────────────────────────────────────────────────

describe("checkUserPolicy: multiple violations collected", () => {
  it("returns all violations, not just the first", () => {
    const policy: UserPolicy = {
      maxRiskLevel:        "low",
      allowedProtocols:    ["aave"],
      maxSingleTxValueUSD: 500,
    };
    const result = checkUserPolicy(policy, {
      ...BASE_ACTION,
      riskLevel:  "high",
      protocol:   "uniswap",
      txValueUSD: 1000,
    });
    expect(result.allowed).toBe(false);
    expect(result.violations).toHaveLength(3);
  });
});

// ── parseUserPolicy ────────────────────────────────────────────────────────

describe("parseUserPolicy", () => {
  it("returns empty object for null/undefined", () => {
    expect(parseUserPolicy(null)).toEqual({});
    expect(parseUserPolicy(undefined)).toEqual({});
  });

  it("returns the object directly when passed a plain object", () => {
    const policy = { maxRiskLevel: "medium" as const };
    expect(parseUserPolicy(policy)).toEqual(policy);
  });

  it("parses a valid JSON string", () => {
    const json = '{"maxRiskLevel":"low","allowedProtocols":["aave"]}';
    const result = parseUserPolicy(json);
    expect(result.maxRiskLevel).toBe("low");
    expect(result.allowedProtocols).toEqual(["aave"]);
  });

  it("returns empty object for invalid JSON string", () => {
    expect(parseUserPolicy("not json {{{")).toEqual({});
  });

  it("returns empty object for an array (not an object)", () => {
    expect(parseUserPolicy(["aave", "mento"])).toEqual({});
  });
});
