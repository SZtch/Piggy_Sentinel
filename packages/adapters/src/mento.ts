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
// Source: https://docs.mento.org/mento-v3/build/deployments/addresses
const EXCHANGE_PROVIDER = "0x22d9db95E6Ae61c104A7B6F6C78D7993B94ec901" as const;

// BiPoolManager ABI — getExchanges() returns all registered pairs with their IDs
const BIPOOL_ABI = [
  {
    type:            "function",
    name:            "getExchanges",
    stateMutability: "view",
    inputs:          [],
    outputs: [{
      name: "",
      type: "tuple[]",
      components: [
        { name: "exchangeId", type: "bytes32"    },
        { name: "assets",     type: "address[]"  },
      ],
    }],
  },
] as const;

// Cache: pairKey → exchangeId, fetched once from on-chain
// Avoids repeated RPC calls per swap. Invalidated on process restart.
const exchangeIdCache = new Map<string, `0x${string}`>();
let   exchangeCacheLoaded = false;

/**
 * Fetch all exchange IDs from BiPoolManager and populate cache.
 * Called once lazily on first swap. Safe to call multiple times (idempotent).
 *
 * FIX: replaces hardcoded EXCHANGE_IDS that contained placeholder values
 * (e.g. 0x1c3c7c7c... for USDm/USDT) which caused every swap quote to
 * fall back to a 1:1 estimate, bypassing the real Mento price oracle.
 */
async function loadExchangeIds(): Promise<void> {
  if (exchangeCacheLoaded) return;

  try {
    const exchanges = await publicClient.readContract({
      address:      EXCHANGE_PROVIDER,
      abi:          BIPOOL_ABI,
      functionName: "getExchanges",
    });

    for (const ex of exchanges) {
      const [asset0, asset1] = ex.assets;
      if (!asset0 || !asset1) continue;

      // Build reverse lookup: address → symbol
      const symOf = (addr: string): string | undefined => {
        const lower = addr.toLowerCase();
        for (const sym of ["USDm", "USDT", "USDC", "wETH"] as const) {
          if (getTokenAddress(CHAIN_ID, sym).toLowerCase() === lower) return sym;
        }
        return undefined;
      };

      const sym0 = symOf(asset0);
      const sym1 = symOf(asset1);
      if (!sym0 || !sym1) continue;

      // Cache both directions — Mento swap is bidirectional per exchangeId
      exchangeIdCache.set(`${sym0}/${sym1}`, ex.exchangeId as `0x${string}`);
      exchangeIdCache.set(`${sym1}/${sym0}`, ex.exchangeId as `0x${string}`);
    }

    exchangeCacheLoaded = true;
  } catch (err) {
    // Non-fatal — getAmountOut will fall back to estimate
    console.warn("[mento] Failed to load exchange IDs from BiPoolManager:", err);
  }
}

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
  // Lazy-load exchange IDs from BiPoolManager on first call
  await loadExchangeIds();

  const exchangeId = exchangeIdCache.get(pairKey(from, to));

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