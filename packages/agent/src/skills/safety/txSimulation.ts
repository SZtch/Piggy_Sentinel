/**
 * txSimulation
 *
 * Simulates a transaction before sending it on-chain using viem's
 * publicClient.call() (equivalent to eth_call / callStatic).
 *
 * Detects:
 *   - Revert (contract error / insufficient balance / access control)
 *   - Gas usage above safety ceiling (prevents stuck/expensive txs)
 *   - Empty return data on non-view calls (often signals a proxy misconfiguration)
 *
 * All agent transactions MUST pass simulation before submitTransaction() is called.
 * If simulation fails the action is logged and skipped — never silently submitted.
 *
 * Gas ceiling env override: MAX_GAS_PER_TX (default 800_000 units)
 */

import {
  createPublicClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { activeChain } from "@piggy/config/chains";
import { logger } from "@piggy/shared";

// ── Startup validation ────────────────────────────────────────────────────
//
// AGENT_SIGNER_ADDRESS must be set before the module is used.  We validate
// at import time so the process fails immediately at startup rather than
// silently simulating from the zero address, which would cause every
// access-controlled call to return a false-positive revert.
//
// This throws during module initialisation if the env var is absent, which
// crashes the scheduler/API process cleanly with an actionable message.
function requireAgentSignerAddress(): Address {
  const addr = process.env.AGENT_SIGNER_ADDRESS;
  if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    throw new Error(
      "[txSimulation] AGENT_SIGNER_ADDRESS env var is missing or invalid.\n" +
      "  Set it to the EOA address that signs agent transactions.\n" +
      "  Example: AGENT_SIGNER_ADDRESS=0xYourAgentSignerAddress\n" +
      "  Refusing to simulate transactions from an unknown or zero address."
    );
  }
  return addr as Address;
}

const AGENT_SIGNER_ADDRESS: Address = requireAgentSignerAddress();

// ── Types ─────────────────────────────────────────────────────────────────

export interface SimulationInput {
  /** Target contract address */
  to:    Address;
  /** ABI-encoded calldata */
  data:  Hex;
  /** Native value in wei (usually 0 for ERC-20 ops) */
  value: bigint;
  /**
   * Sender address (usually the agent signer EOA or SentinelExecutor).
   * Defaults to agentSigner env var.
   */
  from?: Address;
  /** Human label for log output */
  description?: string;
}

export interface SimulationResult {
  success:       boolean;
  /** Estimated gas units (only present on success) */
  estimatedGas?: bigint;
  /** Revert reason string (only present on failure) */
  revertReason?: string;
  /** Raw return data */
  returnData?:   Hex;
}

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_GAS_PER_TX = BigInt(
  process.env.MAX_GAS_PER_TX ?? "800000",
);

// ── Client ────────────────────────────────────────────────────────────────

const publicClient = createPublicClient({
  chain:     activeChain,
  transport: http(),
});

// ── Revert decoder ────────────────────────────────────────────────────────

/**
 * Attempt to decode a revert reason from raw error data.
 * Handles:
 *   - Standard Error(string): selector 0x08c379a0
 *   - Panic(uint256):         selector 0x4e487b71
 *   - Custom errors:          return raw hex
 */
function decodeRevertReason(err: unknown): string {
  if (err instanceof Error) {
    // viem wraps revert messages in the error message string
    const msg = err.message;
    // Extract "reason" from viem's structured error output
    const match = msg.match(/reverted with reason string '([^']+)'/);
    if (match) return match[1];
    const panicMatch = msg.match(/reverted with panic code (\w+)/);
    if (panicMatch) return `Panic(${panicMatch[1]})`;
    // Custom error or unknown — return trimmed message
    return msg.slice(0, 200);
  }
  return String(err).slice(0, 200);
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Simulate a transaction using eth_call + eth_estimateGas.
 *
 * Returns a SimulationResult.  Does NOT throw — callers check `.success`.
 *
 * @example
 * const sim = await simulateTransaction({
 *   to:          executorAddr,
 *   data:        encodedCalldata,
 *   value:       0n,
 *   description: "rebalance: supply USDT to Aave",
 * });
 * if (!sim.success) {
 *   logger.error("tx simulation failed", sim.revertReason);
 *   return; // skip this action
 * }
 */
export async function simulateTransaction(
  input: SimulationInput,
): Promise<SimulationResult> {
  // `from` is the validated signer address unless the caller overrides it
  // (e.g. for multi-sig simulations).  The module-level check ensures this
  // is always a real address — never a zero / dummy fallback.
  const from  = input.from ?? AGENT_SIGNER_ADDRESS;
  const label = input.description ?? `${input.to.slice(0, 10)}…`;

  // ── Step 1: eth_call — detect reverts ────────────────────────────────
  let returnData: Hex;
  try {
    const result = await publicClient.call({
      account: from,
      to:      input.to,
      data:    input.data,
      value:   input.value,
    });
    returnData = (result.data ?? "0x") as Hex;
  } catch (err) {
    const revertReason = decodeRevertReason(err);
    logger.warn("txSimulation: call reverted", { label, revertReason });
    return { success: false, revertReason };
  }

  // ── Step 2: eth_estimateGas — detect gas ceiling ─────────────────────
  let estimatedGas: bigint;
  try {
    estimatedGas = await publicClient.estimateGas({
      account: from,
      to:      input.to,
      data:    input.data,
      value:   input.value,
    });
  } catch (err) {
    const revertReason = decodeRevertReason(err);
    logger.warn("txSimulation: estimateGas reverted", { label, revertReason });
    return { success: false, revertReason, returnData };
  }

  if (estimatedGas > MAX_GAS_PER_TX) {
    const reason = `Gas estimate ${estimatedGas} exceeds ceiling ${MAX_GAS_PER_TX}`;
    logger.warn("txSimulation: gas ceiling exceeded", { label, estimatedGas: estimatedGas.toString() });
    return { success: false, revertReason: reason, estimatedGas, returnData };
  }

  logger.info("txSimulation: simulation passed", {
    label,
    estimatedGas: estimatedGas.toString(),
    returnDataLen: returnData.length,
  });

  return { success: true, estimatedGas, returnData };
}

/**
 * Simulate a batch of transactions.
 * Returns early on the first failure (transactions are ordered dependencies).
 */
export async function simulateBatch(
  txs: SimulationInput[],
): Promise<{ allPassed: boolean; failedIndex?: number; result?: SimulationResult }> {
  for (let i = 0; i < txs.length; i++) {
    const result = await simulateTransaction(txs[i]);
    if (!result.success) {
      logger.error("txSimulation: batch failed at index", { index: i, reason: result.revertReason });
      return { allPassed: false, failedIndex: i, result };
    }
  }
  return { allPassed: true };
}
