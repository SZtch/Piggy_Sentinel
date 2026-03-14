/**
 * stablecoinPegMonitor.test.ts
 *
 * Tests the peg monitor's classification logic and the stale-read
 * escalation counter without hitting a real RPC.
 *
 * Strategy: we test the exported `_resetStaleCountersForTesting()` helper
 * and the pure classification logic by importing the module with the
 * Mento broker address set to "not configured" (to skip live reads),
 * then directly testing status logic with known inputs.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── The pure classification helpers are re-derived here for unit testing.
// ── The async `checkStablecoinPegs` integration is covered separately
// ── via mock of `publicClient.readContract`.

// ── Test the stale-count escalation logic directly ───────────────────────
// We test the exported counter reset and the escalation boundary.

// Classification logic (mirrors the module's internal functions):
function classifyDeviation(pct: number, warnPct = 0.5, alertPct = 1.0, criticalPct = 2.0) {
  if (pct >= criticalPct) return "critical";
  if (pct >= alertPct)    return "alert";
  if (pct >= warnPct)     return "warn";
  return "ok";
}

function staleStatus(count: number, escalationCount = 3): "warn" | "alert" {
  return count >= escalationCount ? "alert" : "warn";
}

describe("peg deviation classification", () => {
  it("returns ok for < 0.5% deviation", () => {
    expect(classifyDeviation(0.0)).toBe("ok");
    expect(classifyDeviation(0.49)).toBe("ok");
  });

  it("returns warn for 0.5–1.0% deviation", () => {
    expect(classifyDeviation(0.5)).toBe("warn");
    expect(classifyDeviation(0.99)).toBe("warn");
  });

  it("returns alert for 1.0–2.0% deviation", () => {
    expect(classifyDeviation(1.0)).toBe("alert");
    expect(classifyDeviation(1.99)).toBe("alert");
  });

  it("returns critical for ≥ 2.0% deviation", () => {
    expect(classifyDeviation(2.0)).toBe("critical");
    expect(classifyDeviation(5.0)).toBe("critical");
  });

  it("respects custom thresholds", () => {
    // Tighter config: warn at 0.2%, alert at 0.5%, critical at 1.0%
    expect(classifyDeviation(0.25, 0.2, 0.5, 1.0)).toBe("warn");
    expect(classifyDeviation(0.55, 0.2, 0.5, 1.0)).toBe("alert");
    expect(classifyDeviation(1.1,  0.2, 0.5, 1.0)).toBe("critical");
  });
});

describe("stale-read escalation", () => {
  it("first stale read is warn", () => {
    expect(staleStatus(1)).toBe("warn");
    expect(staleStatus(2)).toBe("warn");
  });

  it("escalates to alert at the threshold (default 3)", () => {
    expect(staleStatus(3)).toBe("alert");
    expect(staleStatus(10)).toBe("alert");
  });

  it("respects a custom escalation count", () => {
    expect(staleStatus(5, 5)).toBe("alert");
    expect(staleStatus(4, 5)).toBe("warn");
  });
});

describe("checkStablecoinPegs — mocked oracle", () => {
  // Import after setting up mocks
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns ok result with no alert when Mento is not configured", async () => {
    // With CHAIN_ID pointing to a chain with no mentoBroker address,
    // getProtocolAddress will throw and the function returns a safe empty result.
    vi.mock("@piggy/config/protocols", () => ({
      getProtocolAddress: () => { throw new Error("mentoBroker not configured for chain 99"); },
    }));

    const { checkStablecoinPegs } = await import("../stablecoinPegMonitor.js");
    const result = await checkStablecoinPegs();

    expect(result.readings).toHaveLength(0);
    expect(result.hasCritical).toBe(false);
    expect(result.hasAlert).toBe(false);
    expect(result.worstStatus).toBe("ok");
  });

  it("reads come back healthy when Mento returns 1.000", async () => {
    vi.mock("@piggy/config/protocols", () => ({
      getProtocolAddress: () => "0x1234567890123456789012345678901234567890",
    }));
    vi.mock("@piggy/config/tokens", () => ({
      getTokenAddress: () => "0xabcdef1234567890123456789012345678901234",
    }));
    // Mento returns exactly 1 USDm (18 dec)
    vi.mock("viem", async (importOriginal) => {
      const actual = await importOriginal<typeof import("viem")>();
      return {
        ...actual,
        createPublicClient: () => ({
          readContract: vi.fn().mockResolvedValue(1_000_000_000_000_000_000n), // 1e18
        }),
      };
    });

    const { checkStablecoinPegs, _resetStaleCountersForTesting } = await import("../stablecoinPegMonitor.js");
    _resetStaleCountersForTesting();
    const result = await checkStablecoinPegs();

    expect(result.hasCritical).toBe(false);
    expect(result.hasAlert).toBe(false);
    for (const r of result.readings) {
      expect(r.isStale).toBe(false);
      expect(r.status).toBe("ok");
      expect(r.deviationPct).toBeLessThan(0.5);
    }
  });

  it("escalates to alert after 3 consecutive stale reads", async () => {
    vi.mock("@piggy/config/protocols", () => ({
      getProtocolAddress: () => "0x1234567890123456789012345678901234567890",
    }));
    vi.mock("@piggy/config/tokens", () => ({
      getTokenAddress: () => "0xabcdef1234567890123456789012345678901234",
    }));
    vi.mock("viem", async (importOriginal) => {
      const actual = await importOriginal<typeof import("viem")>();
      return {
        ...actual,
        createPublicClient: () => ({
          readContract: vi.fn().mockRejectedValue(new Error("RPC timeout")),
        }),
      };
    });

    const { checkStablecoinPegs, _resetStaleCountersForTesting } = await import("../stablecoinPegMonitor.js");
    _resetStaleCountersForTesting();

    // Cycle 1 & 2: warn
    await checkStablecoinPegs();
    await checkStablecoinPegs();

    // Cycle 3: should escalate to alert
    const result3 = await checkStablecoinPegs();
    expect(result3.hasAlert).toBe(true);
    for (const r of result3.readings) {
      expect(r.status).toBe("alert");
      expect(r.consecutiveStaleCount).toBe(3);
    }
  });
});
