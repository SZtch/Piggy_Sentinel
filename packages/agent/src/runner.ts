import {
  createWalletClient, createPublicClient, http,
  type Hash, type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { activeChain } from "@piggy/config/chains";
import { logger, sleep } from "@piggy/shared";
import { MAX_TX_RETRIES, TX_RETRY_DELAYS_MS } from "@piggy/shared";
import { enforceChainGuards, assertMainnetGate } from "./guards.js";
import type { TxCalldata } from "@piggy/skills";

// Run guards once at module load — fail fast on misconfiguration
enforceChainGuards();

// Guard: APP_ENV must be explicitly set. Defaulting to "dev" on mainnet
// would route all transactions to Celo Sepolia while the agent thinks it's
// on mainnet, silently failing every tx without a clear error.
const APP_ENV = process.env.APP_ENV;
if (!APP_ENV) {
  throw new Error(
    "[runner] APP_ENV is not set.\n" +
    "  Set APP_ENV=dev for testnet or APP_ENV=prod for mainnet in your .env file.\n" +
    "  Never leave this unset — the active chain is determined by this value."
  );
}

const relayerKey = process.env.AGENT_SIGNER_PRIVATE_KEY as `0x${string}` | undefined;
if (!relayerKey || relayerKey === "0x0000000000000000000000000000000000000000000000000000000000000001") {
  logger.warn("AGENT_SIGNER_PRIVATE_KEY is placeholder — on-chain skills will fail");
}

const account = relayerKey ? privateKeyToAccount(relayerKey) : undefined;

const walletClient = account
  ? createWalletClient({
      account,
      chain: activeChain,
      transport: http(),
    })
  : null;

const publicClient = createPublicClient({ chain: activeChain, transport: http() });

/**
 * Submit a transaction.
 * Gas is paid in native CELO from the agent wallet.
 * The agent wallet must hold enough CELO to cover gas fees.
 */
export async function submitTransaction(tx: TxCalldata): Promise<Hash> {
  assertMainnetGate();

  if (!walletClient || !account) {
    throw new Error("No agent signer wallet — set AGENT_SIGNER_PRIVATE_KEY in .env");
  }

  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= MAX_TX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = TX_RETRY_DELAYS_MS[attempt - 1] ?? 60_000;
        logger.warn(`TX retry ${attempt}/${MAX_TX_RETRIES} after ${delay}ms`);
        await sleep(delay);
      }

      const hash = await walletClient.sendTransaction({
        to:    tx.to,
        data:  tx.data,
        value: tx.value ?? 0n,
        // feeCurrency is omitted — gas paid in native CELO
      } as any);

      logger.info(`TX submitted: ${hash}`);

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "reverted") throw new Error(`Transaction reverted: ${hash}`);

      logger.info(`TX confirmed: ${hash} (block ${receipt.blockNumber})`);
      return hash;

    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      logger.error(`TX attempt ${attempt + 1} failed`, lastErr.message);
    }
  }

  throw lastErr ?? new Error("TX submission failed");
}

export async function getAgentBalance(): Promise<bigint> {
  if (!account) return 0n;
  return publicClient.getBalance({ address: account.address });
}

export async function getAgentAddress(): Promise<string> {
  return account?.address ?? "not configured";
}
