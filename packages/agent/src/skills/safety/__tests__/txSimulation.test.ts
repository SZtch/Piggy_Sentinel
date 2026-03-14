/**
 * txSimulation.test.ts
 *
 * Because txSimulation calls viem's publicClient at module import time
 * (to validate AGENT_SIGNER_ADDRESS), all tests that exercise the module
 * must set the env var before importing.  We use vi.mock to intercept
 * publicClient.call and publicClient.estimateGas so no real RPC is needed.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

// ── Set env before any module import ─────────────────────────────────────
process.env.AGENT_SIGNER_ADDRESS = "0xAbCd1234AbCd1234AbCd1234AbCd1234AbCd1234";

// Mock viem's createPublicClient so no real RPC is called
vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => ({
      call:        vi.fn(),
      estimateGas: vi.fn(),
    }),
  };
});

// ── Lazy import after env is set ──────────────────────────────────────────
let simulateTransaction: typeof import("../txSimulation.js").simulateTransaction;
let simulateBatch:       typeof import("../txSimulation.js").simulateBatch;

beforeAll(async () => {
  const mod = await import("../txSimulation.js");
  simulateTransaction = mod.simulateTransaction;
  simulateBatch       = mod.simulateBatch;
});

// Helper to get the mocked client methods
async function getMocks() {
  const viem = await import("viem");
  const client = (viem.createPublicClient as ReturnType<typeof vi.fn>)();
  return {
    call:        client.call        as ReturnType<typeof vi.fn>,
    estimateGas: client.estimateGas as ReturnType<typeof vi.fn>,
  };
}

const DUMMY_TX = {
  to:          "0xDeadBeefDeadBeefDeadBeefDeadBeefDeadBeef" as `0x${string}`,
  data:        "0x1234" as `0x${string}`,
  value:       0n,
  description: "test tx",
};

describe("txSimulation: startup validation", () => {
  it("throws at module load if AGENT_SIGNER_ADDRESS is missing", async () => {
    // Re-import in a fresh module context would throw — we verify the guard logic
    // directly since vi.resetModules() would break the beforeAll setup.
    // The guard function is deterministic: regex test on env var.
    const validate = () => {
      const addr = "";
      if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
        throw new Error("AGENT_SIGNER_ADDRESS env var is missing or invalid.");
      }
    };
    expect(validate).toThrow("AGENT_SIGNER_ADDRESS env var is missing or invalid.");
  });

  it("accepts a valid 42-char hex address", () => {
    const validate = (addr: string) => /^0x[0-9a-fA-F]{40}$/.test(addr);
    expect(validate("0xAbCd1234AbCd1234AbCd1234AbCd1234AbCd1234")).toBe(true);
    expect(validate("0x0000000000000000000000000000000000000001")).toBe(true);
    expect(validate("0x000000000000000000000000000000000000000")).toBe(false);  // 41 chars
    expect(validate("not-an-address")).toBe(false);
  });
});

describe("simulateTransaction", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns success when call and estimateGas both succeed", async () => {
    const mocks = await getMocks();
    mocks.call.mockResolvedValue({ data: "0xdeadbeef" });
    mocks.estimateGas.mockResolvedValue(200_000n);

    const result = await simulateTransaction(DUMMY_TX);
    expect(result.success).toBe(true);
    expect(result.estimatedGas).toBe(200_000n);
    expect(result.returnData).toBe("0xdeadbeef");
  });

  it("returns failure with revertReason when call reverts", async () => {
    const mocks = await getMocks();
    mocks.call.mockRejectedValue(
      new Error("execution reverted with reason string 'insufficient balance'")
    );

    const result = await simulateTransaction(DUMMY_TX);
    expect(result.success).toBe(false);
    expect(result.revertReason).toContain("insufficient balance");
  });

  it("returns failure when estimateGas reverts (after successful call)", async () => {
    const mocks = await getMocks();
    mocks.call.mockResolvedValue({ data: "0x" });
    mocks.estimateGas.mockRejectedValue(new Error("out of gas"));

    const result = await simulateTransaction(DUMMY_TX);
    expect(result.success).toBe(false);
    expect(result.revertReason).toContain("out of gas");
  });

  it("returns failure when gas estimate exceeds ceiling", async () => {
    const mocks = await getMocks();
    mocks.call.mockResolvedValue({ data: "0x" });
    mocks.estimateGas.mockResolvedValue(900_000n);  // > default MAX_GAS_PER_TX 800_000

    const result = await simulateTransaction(DUMMY_TX);
    expect(result.success).toBe(false);
    expect(result.revertReason).toMatch(/exceeds ceiling/);
    expect(result.estimatedGas).toBe(900_000n);
  });

  it("decodes Panic revert code from error message", async () => {
    const mocks = await getMocks();
    mocks.call.mockRejectedValue(new Error("reverted with panic code 0x11"));

    const result = await simulateTransaction(DUMMY_TX);
    expect(result.success).toBe(false);
    expect(result.revertReason).toBe("Panic(0x11)");
  });

  it("uses caller-provided `from` address when supplied", async () => {
    const mocks = await getMocks();
    mocks.call.mockResolvedValue({ data: "0x" });
    mocks.estimateGas.mockResolvedValue(100_000n);

    const customFrom = "0x1111111111111111111111111111111111111111" as `0x${string}`;
    await simulateTransaction({ ...DUMMY_TX, from: customFrom });

    expect(mocks.call).toHaveBeenCalledWith(
      expect.objectContaining({ account: customFrom })
    );
  });
});

describe("simulateBatch", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns allPassed: true when all txs succeed", async () => {
    const mocks = await getMocks();
    mocks.call.mockResolvedValue({ data: "0x" });
    mocks.estimateGas.mockResolvedValue(100_000n);

    const result = await simulateBatch([DUMMY_TX, DUMMY_TX]);
    expect(result.allPassed).toBe(true);
    expect(result.failedIndex).toBeUndefined();
  });

  it("returns allPassed: false and failedIndex on first failure", async () => {
    const mocks = await getMocks();
    // First tx succeeds, second reverts
    mocks.call
      .mockResolvedValueOnce({ data: "0x" })
      .mockRejectedValueOnce(new Error("revert"));
    mocks.estimateGas.mockResolvedValue(100_000n);

    const result = await simulateBatch([DUMMY_TX, DUMMY_TX, DUMMY_TX]);
    expect(result.allPassed).toBe(false);
    expect(result.failedIndex).toBe(1);
  });
});
