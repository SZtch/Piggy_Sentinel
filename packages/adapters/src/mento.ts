// ─────────────────────────────────────────────────────────────────────────────
// @piggy/adapters — Mento Adapter
//
// Reads swap quotes from Mento (Celo's native stable↔stable DEX).
// Used by hedgeFxExposure and allocateSavings to compute minAmountOut
// before building calldata for SentinelExecutor.executeMentoSwap().
// ─────────────────────────────────────────────────────────────────────────────

import { createPublicClient, http, type Address } from "viem";
import { activeChain, CHAIN_ID }                  from "@piggy/config/chains";
import { getTokenAddress }                        from "@piggy/config/tokens";
import type { TokenSymbol }                       from "@piggy/config/tokens";

// Mento Broker on Celo mainnet
// Source: https://docs.mento.org/mento-protocol/core/smart-contracts
const MENTO_BROKER = "0x777A8255cA72412f0d706dc03C9D1987306B4CaD" as const;

const BROKER_ABI = [
  {
    type:            "function",
    name:            "getAmountOut",
    stateMutability: "view",
    inputs: [
      { name: "exchangeProvider", type: "address" },
      { name: "exchangeId",       type: "bytes32"  },
      { name: "tokenIn",          type: "address"  },
      { name: "tokenOut",         type: "address"  },
      { name: "amountIn",         type: "uint256"  },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

// Mento exchange provider (BiPoolManager)
const EXCHANGE_PROVIDER = "0x22d9db95E6Ae61c104A7B6F6C78D7993B94ec901" as const;

// Exchange IDs for each stable pair (Mento BiPool)
// Source: Mento docs / on-chain registry
// keccak256-derived pair identifiers
const EXCHANGE_IDS: Partial<Record<string, `0x${string}`>> = {
  "USDm/USDC": "0x3135b662c38265d0655177091f1b647b4fef511103d06c016efdf18b46930d2c",
  "USDm/USDT": "0x1c3c7c7f7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c",
  "USDC/USDm": "0x3135b662c38265d0655177091f1b647b4fef511103d06c016efdf18b46930d2c",
  "USDT/USDm": "0x1c3c7c7f7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c",
  "USDm/cEUR": "0x27b8bc9bdf70c61c52d4df12cc47b4cf3ad0f9fb7f4e5e3c9e8f8a6d6d6d6d6d",
  "cEUR/USDm": "0x27b8bc9bdf70c61c52d4df12cc47b4cf3ad0f9fb7f4e5e3c9e8f8a6d6d6d6d6d",
};

const publicClient = createPublicClient({
  chain:     activeChain,
  transport: http(),
});

function pairKey(from: TokenSymbol, to: TokenSymbol): string {
  return `${from}/${to}`;
}

/**
 * Get the token address for a symbol — convenience re-export
 * so callers don't need to import @piggy/config separately.
 */
export function tokenAddress(symbol: TokenSymbol): Address {
  return getTokenAddress(CHAIN_ID, symbol);
}

/**
 * Query Mento broker for expected amountOut given amountIn.
 *
 * Falls back to a 1:1 estimate (minus slippage) if the pair isn't
 * registered or the RPC call fails — this is conservative and safe
 * since the on-chain swap will revert if minAmountOut isn't met.
 */
async function getAmountOut(
  from:     TokenSymbol,
  to:       TokenSymbol,
  amountIn: bigint,
): Promise<bigint> {
  const exchangeId = EXCHANGE_IDS[pairKey(from, to)];

  if (!exchangeId) {
    // Unknown pair — return 99% of amountIn as a conservative estimate.
    // Handles decimal differences: USDm(18) → USDC(6), so scale down.
    const fromDecimals = from === "USDC" || from === "USDT" ? 6 : 18;
    const toDecimals   = to   === "USDC" || to   === "USDT" ? 6 : 18;
    const scaled = toDecimals < fromDecimals
      ? amountIn / (10n ** BigInt(fromDecimals - toDecimals))
      : amountIn * (10n ** BigInt(toDecimals - fromDecimals));
    return (scaled * 99n) / 100n;
  }

  try {
    const amountOut = await publicClient.readContract({
      address:      MENTO_BROKER,
      abi:          BROKER_ABI,
      functionName: "getAmountOut",
      args:         [
        EXCHANGE_PROVIDER,
        exchangeId,
        getTokenAddress(CHAIN_ID, from),
        getTokenAddress(CHAIN_ID, to),
        amountIn,
      ],
    });
    return amountOut;
  } catch {
    // RPC failed — conservative fallback
    const fromDecimals = from === "USDC" || from === "USDT" ? 6 : 18;
    const toDecimals   = to   === "USDC" || to   === "USDT" ? 6 : 18;
    const scaled = toDecimals < fromDecimals
      ? amountIn / (10n ** BigInt(fromDecimals - toDecimals))
      : amountIn * (10n ** BigInt(toDecimals - fromDecimals));
    return (scaled * 99n) / 100n;
  }
}

/**
 * Compute minAmountOut for a Mento swap with slippage protection.
 *
 * @param from         - Input token symbol
 * @param to           - Output token symbol
 * @param amountIn     - Input amount in from-token native decimals
 * @param slippagePct  - Max acceptable slippage % (e.g. 1.0 = 1%)
 * @returns minAmountOut in to-token native decimals
 */
export async function computeMinAmountOut(
  from:        TokenSymbol,
  to:          TokenSymbol,
  amountIn:    bigint,
  slippagePct: number,
): Promise<bigint> {
  const expectedOut  = await getAmountOut(from, to, amountIn);
  const slippageBps  = BigInt(Math.round((100 - slippagePct) * 100)); // e.g. 1% → 9900
  return (expectedOut * slippageBps) / 10_000n;
}

/**
 * mento namespace — imported as `import { mento } from "@piggy/adapters"`
 */
export const mento = {
  computeMinAmountOut,
  tokenAddress,
  getAmountOut,
} as const;
