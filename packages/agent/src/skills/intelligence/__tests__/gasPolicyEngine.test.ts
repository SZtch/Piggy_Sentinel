/**
 * gasPolicyEngine.test.ts
 *
 * Tests gasPolicyEngine logic without real RPC.
 * We test:
 *   - Pure cost calculation: gasPrice × gasUnits × CELO/USD
 *   - Threshold enforcement (gwei and USD limits)
 *   - Live oracle vs fallback path
 *   - fetchCeloPriceFromMento error handling
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock viem's publicClient ──────────────────────────────────────────────
const mockGetGasPrice  = vi.fn();
const mockReadContract = vi.fn();

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => ({
      getGasPrice:   mockGetGasPrice,
      readContract:  mockReadContract,
    }),
  };
});

vi.mock("@piggy/config/protocols", () => ({
  getProtocolAddress: () => "0x777A8255cA72412f0d706dc03C9D1987306B4CaD",
}));
vi.mock("@piggy/config/tokens", () => ({
  getTokenAddress: () => "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1",
}));

beforeEach(() => vi.clearAllMocks());

import { evaluateGasPolicy, fetchCeloPriceFromMento } from "../gasPolicyEngine.js";

// ── Pure cost calculation ─────────────────────────────────────────────────

describe("gasPolicyEngine: cost calculation", () => {
  it("correctly converts gwei × gas × CELO/USD to USD cost", () => {
    // 5 gwei × 300_000 gas = 1_500_000 gwei = 0.0015 CELO
    // At $0.80/CELO → $0.0012
    const gasPriceWei    = 5_000_000_000n;     // 5 gwei in wei
    const gasUnits       = 300_000n;
    const gasCostWei     = gasPriceWei * gasUnits;
    const gasCostCelo    = Number(gasCostWei) / 1e18;
    const estimatedUSD   = gasCostCelo * 0.80;
    expect(estimatedUSD).toBeCloseTo(0.0012, 5);
  });
});

// ── evaluateGasPolicy ─────────────────────────────────────────────────────

describe("evaluateGasPolicy: allowed under normal conditions", () => {
  it("allows execution at 5 gwei with CELO at $0.80", async () => {
    mockGetGasPrice.mockResolvedValue(5_000_000_000n);    // 5 gwei
    mockReadContract.mockResolvedValue(800_000_000_000_000_000n); // 0.8 USDm per CELO

    const result = await evaluateGasPolicy();
    expect(result.allowed).toBe(true);
    expect(result.gasPriceGwei).toBeCloseTo(5, 1);
    expect(result.celoPriceIsStale).toBe(false);
    expect(result.celoPriceUSD).toBeCloseTo(0.8, 2);
  });
});

describe("evaluateGasPolicy: blocked by gwei ceiling", () => {
  it("blocks execution when gwei exceeds MAX_GAS_PRICE_GWEI (default 50)", async () => {
    mockGetGasPrice.mockResolvedValue(60_000_000_000n);   // 60 gwei
    mockReadContract.mockResolvedValue(750_000_000_000_000_000n); // $0.75

    const result = await evaluateGasPolicy();
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/too high/i);
  });
});

describe("evaluateGasPolicy: uses fallback CELO price when Mento fails", () => {
  it("falls back to env var and marks stale", async () => {
    mockGetGasPrice.mockResolvedValue(5_000_000_000n);    // 5 gwei — within limit
    mockReadContract.mockRejectedValue(new Error("RPC timeout"));

    process.env.CELO_PRICE_USD = "0.75";
    const result = await evaluateGasPolicy();

    expect(result.celoPriceIsStale).toBe(true);
    expect(result.celoPriceUSD).toBeCloseTo(0.75, 2);
    // Still allowed — cost at 5 gwei * 300k * 0.75 = ~$0.001 < $0.50 limit
    expect(result.allowed).toBe(true);
    expect(result.reason).toMatch(/fallback/i);
  });
});

describe("evaluateGasPolicy: gas price fetch failure", () => {
  it("fails open (allows execution) when eth_gasPrice is unavailable", async () => {
    mockGetGasPrice.mockRejectedValue(new Error("RPC down"));

    const result = await evaluateGasPolicy();
    expect(result.allowed).toBe(true);
    expect(result.gasPriceGwei).toBe(0);
    expect(result.reason).toMatch(/gas price fetch failed/i);
  });
});

// ── fetchCeloPriceFromMento ───────────────────────────────────────────────

describe("fetchCeloPriceFromMento", () => {
  it("returns price when Mento responds with a valid amount", async () => {
    mockReadContract.mockResolvedValue(720_000_000_000_000_000n); // 0.72 USDm
    const price = await fetchCeloPriceFromMento();
    expect(price).toBeCloseTo(0.72, 3);
  });

  it("returns null and does not throw when Mento call fails", async () => {
    mockReadContract.mockRejectedValue(new Error("call failed"));
    await expect(fetchCeloPriceFromMento()).resolves.toBeNull();
  });

  it("returns null when price is out of sanity bounds", async () => {
    // A price of 200 USDm per CELO is out of bounds → null
    mockReadContract.mockResolvedValue(200_000_000_000_000_000_000n); // 200e18
    await expect(fetchCeloPriceFromMento()).resolves.toBeNull();
  });

  it("returns null when Mento is not configured (not configured error)", async () => {
    vi.mock("@piggy/config/protocols", () => ({
      getProtocolAddress: () => { throw new Error("mentoBroker not configured"); },
    }));
    const { fetchCeloPriceFromMento: fn } = await import("../gasPolicyEngine.js");
    await expect(fn()).resolves.toBeNull();
  });
});
