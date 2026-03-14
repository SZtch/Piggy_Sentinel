// ─────────────────────────────────────────────────────────────────────────────
// @piggy/agent — Transaction Submitter & Agent Wallet
//
// The agent signer wallet is a hot wallet controlled by the backend.
// It NEVER holds user funds — it only calls SentinelExecutor on behalf
// of users who have authorised it via the smart contract.
// ─────────────────────────────────────────────────────────────────────────────

import {
  createWalletClient, createPublicClient,
  http, type Address, type Hex,
} from "viem";
import { privateKeyToAccount }  from "viem/accounts";
import { activeChain }          from "@piggy/config/chains";
import { logger }               from "@piggy/shared";

// ── Agent wallet setup ────────────────────────────────────────────────────────

function getAgentAccount() {
  const pk = process.env.AGENT_SIGNER_PRIVATE_KEY as Hex | undefined;
  if (!pk) throw new Error("AGENT_SIGNER_PRIVATE_KEY is not set");
  return privateKeyToAccount(pk);
}

const publicClient = createPublicClient({
  chain:     activeChain,
  transport: http(),
});

function getWalletClient() {
  return createWalletClient({
    account:   getAgentAccount(),
    chain:     activeChain,
    transport: http(),
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Returns the agent signer's Ethereum address. */
export async function getAgentAddress(): Promise<Address> {
  return getAgentAccount().address;
}

/**
 * Returns the agent wallet's native CELO balance in wei.
 * Used in /health to surface low-balance warnings.
 */
export async function getAgentBalance(): Promise<bigint> {
  const address = getAgentAccount().address;
  return publicClient.getBalance({ address });
}

export interface TxRequest {
  to:    Address;
  data?: Hex;
  value: bigint;
}

/**
 * Sign and broadcast a transaction from the agent wallet.
 *
 * Gas estimation is done automatically. MAX_GAS_PER_TX env var
 * caps gas to prevent runaway transactions.
 *
 * @returns Transaction hash (0x-prefixed)
 */
export async function submitTransaction(tx: TxRequest): Promise<string> {
  const walletClient = getWalletClient();
  const maxGas       = BigInt(process.env.MAX_GAS_PER_TX ?? "800000");

  // Estimate gas first for logging
  let gasEstimate: bigint;
  try {
    gasEstimate = await publicClient.estimateGas({
      account: getAgentAccount().address,
      to:      tx.to,
      data:    tx.data,
      value:   tx.value,
    });
  } catch (err) {
    throw new Error(
      `Gas estimation failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (gasEstimate > maxGas) {
    throw new Error(`Gas estimate ${gasEstimate} exceeds MAX_GAS_PER_TX ${maxGas}`);
  }

  const hash = await walletClient.sendTransaction({
    to:    tx.to,
    data:  tx.data,
    value: tx.value,
    gas:   gasEstimate + (gasEstimate / 10n), // +10% buffer
  });

  logger.info("agent: tx submitted", { hash, to: tx.to, gas: gasEstimate.toString() });

  // Wait for receipt
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: 60_000,
  });

  if (receipt.status !== "success") {
    throw new Error(`Transaction reverted: ${hash}`);
  }

  logger.info("agent: tx confirmed", { hash, block: receipt.blockNumber.toString() });

  return hash;
}
