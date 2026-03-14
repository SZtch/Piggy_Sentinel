/**
 * circuitBreaker.test.ts
 *
 * The circuit breaker has three pure-logic triggers and three I/O side effects
 * (DB pause, agentscan event, Telegram notification).  Tests verify:
 *   - Trigger logic (peg, risk, volatility) without real I/O
 *   - No-trigger path
 *   - First-trigger-wins ordering (peg beats risk beats volatility)
 *
 * All DB/Telegram/agentscan calls are mocked so no real services are hit.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock all I/O dependencies ─────────────────────────────────────────────
vi.mock("@piggy/db", () => ({
  setSoftPausedByOwner: vi.fn().mockResolvedValue(undefined),
  insertNotification:   vi.fn().mockResolvedValue(undefined),
  getTelegramChatId:    vi.fn().mockResolvedValue("telegram-chat-123"),
}));

vi.mock("@piggy/observability", () => ({
  emitAgentEvent: vi.fn().mockResolvedValue(undefined),
}));

import { evaluateCircuitBreaker } from "../circuitBreaker.js";
import { setSoftPausedByOwner }   from "@piggy/db";
import { emitAgentEvent }         from "@piggy/observability";
import type { PegMonitorResult }  from "../stablecoinPegMonitor.js";
import type { RiskScore }         from "../riskScoringEngine.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

const BASE_INPUT = {
  goalId:      "goal-abc",
  userWallet:  "0xUser",
  agentWallet: "0xAgent",
};

function makePegResult(worst: "ok" | "warn" | "alert" | "critical"): PegMonitorResult {
  const isCritical = worst === "critical";
  const isAlert    = worst === "alert" || isCritical;
  return {
    worstStatus: worst,
    hasAlert:    isAlert,
    hasCritical: isCritical,
    readings: isCritical ? [{
      token: "USDm" as const, priceUSD: 0.95, deviationPct: 5,
      status: "critical", message: "CRITICAL", isStale: false, consecutiveStaleCount: 0,
    }] : [],
  };
}

function makeCriticalRisk(): RiskScore {
  return {
    score: 95, level: "critical",
    components: { apyRisk: 80, liquidityRisk: 90, volatilityRisk: 80, pegDeviationRisk: 100 },
    dominantFactor: "Stablecoin peg health",
    recommendation: "Exit immediately.",
  };
}

function makeHighRisk(): RiskScore {
  return { ...makeCriticalRisk(), score: 75, level: "high" };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("evaluateCircuitBreaker — no trigger", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns tripped:false when all inputs are safe", async () => {
    const result = await evaluateCircuitBreaker({
      ...BASE_INPUT,
      pegResult:    makePegResult("ok"),
      riskScore:    makeHighRisk(),  // high but not critical
      volatilityPct: 5.0,           // below 15% default threshold
    });
    expect(result.tripped).toBe(false);
    expect(setSoftPausedByOwner).not.toHaveBeenCalled();
    expect(emitAgentEvent).not.toHaveBeenCalled();
  });

  it("returns tripped:false when all optional fields are null", async () => {
    const result = await evaluateCircuitBreaker({
      ...BASE_INPUT,
      pegResult:    null,
      riskScore:    null,
      volatilityPct: null,
    });
    expect(result.tripped).toBe(false);
  });
});

describe("evaluateCircuitBreaker — peg trigger", () => {
  beforeEach(() => vi.clearAllMocks());

  it("trips on critical peg deviation", async () => {
    const result = await evaluateCircuitBreaker({
      ...BASE_INPUT,
      pegResult: makePegResult("critical"),
    });
    expect(result.tripped).toBe(true);
    expect(result.trigger).toBe("peg_deviation");
    expect(result.reason).toMatch(/depeg/i);
  });

  it("does NOT trip on alert-level peg (only critical trips)", async () => {
    const result = await evaluateCircuitBreaker({
      ...BASE_INPUT,
      pegResult: makePegResult("alert"),
    });
    expect(result.tripped).toBe(false);
  });

  it("calls setSoftPausedByOwner and emitAgentEvent when tripped", async () => {
    await evaluateCircuitBreaker({
      ...BASE_INPUT,
      pegResult: makePegResult("critical"),
    });
    expect(setSoftPausedByOwner).toHaveBeenCalledWith(BASE_INPUT.userWallet, true);
    expect(emitAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "CIRCUIT_BREAKER_TRIPPED" })
    );
  });
});

describe("evaluateCircuitBreaker — risk trigger", () => {
  beforeEach(() => vi.clearAllMocks());

  it("trips on critical risk score", async () => {
    const result = await evaluateCircuitBreaker({
      ...BASE_INPUT,
      pegResult: makePegResult("ok"),
      riskScore: makeCriticalRisk(),
    });
    expect(result.tripped).toBe(true);
    expect(result.trigger).toBe("critical_risk_score");
    expect(result.reason).toMatch(/critical/i);
  });

  it("does NOT trip on high risk score", async () => {
    const result = await evaluateCircuitBreaker({
      ...BASE_INPUT,
      riskScore: makeHighRisk(),
    });
    expect(result.tripped).toBe(false);
  });
});

describe("evaluateCircuitBreaker — volatility trigger", () => {
  beforeEach(() => vi.clearAllMocks());

  it("trips when volatilityPct exceeds 15% default threshold", async () => {
    const result = await evaluateCircuitBreaker({
      ...BASE_INPUT,
      volatilityPct: 20.0,
    });
    expect(result.tripped).toBe(true);
    expect(result.trigger).toBe("volatility_spike");
  });

  it("does NOT trip at exactly the threshold (> not >=)", async () => {
    const result = await evaluateCircuitBreaker({
      ...BASE_INPUT,
      volatilityPct: 15.0,
    });
    expect(result.tripped).toBe(false);
  });

  it("skips volatility check when volatilityPct is null", async () => {
    const result = await evaluateCircuitBreaker({
      ...BASE_INPUT,
      volatilityPct: null,
    });
    expect(result.tripped).toBe(false);
  });
});

describe("evaluateCircuitBreaker — first-trigger-wins", () => {
  beforeEach(() => vi.clearAllMocks());

  it("peg trigger wins over risk trigger when both fire", async () => {
    const result = await evaluateCircuitBreaker({
      ...BASE_INPUT,
      pegResult:    makePegResult("critical"),
      riskScore:    makeCriticalRisk(),
      volatilityPct: 25.0,
    });
    expect(result.trigger).toBe("peg_deviation");
  });

  it("risk trigger wins over volatility when peg is fine", async () => {
    const result = await evaluateCircuitBreaker({
      ...BASE_INPUT,
      pegResult:    makePegResult("ok"),
      riskScore:    makeCriticalRisk(),
      volatilityPct: 25.0,
    });
    expect(result.trigger).toBe("critical_risk_score");
  });
});
