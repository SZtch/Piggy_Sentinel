/**
 * volatilityOracle
 *
 * Derives 24-hour price volatility from the Uniswap V3 USDC/WETH pool
 * TWAP oracle using the `observe([86400, 0])` call.
 *
 * Method:
 *   Uniswap V3 accumulates tick values over time.  By reading two points
 *   on the accumulator — now (secondsAgo=0) and 24h ago (secondsAgo=86400)
 *   — we can derive the geometric mean price over the interval.
 *
 *   tickCumulative = ∑ tick × seconds
 *   meanTick = (tickCumulative[now] - tickCumulative[24h ago]) / 86400
 *   price = 1.0001^tick  (the standard Uniswap V3 price formula)
 *
 * Volatility = |price_now - price_24h_ago| / price_24h_ago × 100 (%)
 *
 * This is absolute 24h return (not annualised).  For a stablecoin-dominated
 * portfolio, the dominant volatility driver is WETH, so this is used as the
 * portfolio's volatility proxy.
 *
 * Fallback:
 *   Returns null if the pool address is not configured or the RPC call fails.
 *   The circuit breaker skips the volatility check when volatilityPct is null.
 *
 * Env:
 *   UNISWAP_USDC_WETH_POOL  — pool address (required; set after contract deploy)
 */

import {
  createPublicClient,
  http,
  type Address,
} from "viem";
import { activeChain } from "@piggy/config/chains";
import { logger }      from "@piggy/shared";

// ── ABI ───────────────────────────────────────────────────────────────────

const UNISWAP_OBSERVE_ABI = [{
  name:   "observe",
  type:   "function",
  inputs: [{
    name: "secondsAgos",
    type: "uint32[]",
  }],
  outputs: [
    { name: "tickCumulatives",                    type: "int56[]"  },
    { name: "secondsPerLiquidityCumulativeX128s", type: "uint160[]" },
  ],
  stateMutability: "view",
}] as const;

// ── Client ────────────────────────────────────────────────────────────────

const publicClient = createPublicClient({ chain: activeChain, transport: http() });

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Convert a Uniswap V3 tick to a price.
 * price = 1.0001^tick
 * For USDC(token0) / WETH(token1): price is WETH in USDC units (≈ USD/ETH).
 * After decimal adjustment (18 - 6 = 12) this gives USD per WETH.
 */
function tickToPrice(tick: number): number {
  // Raw price from tick
  const raw = Math.pow(1.0001, tick);
  // Adjust for USDC (6 dec) / WETH (18 dec): multiply by 10^(18-6)
  return raw * 1e12;
}

// ── Main export ────────────────────────────────────────────────────────────

export interface VolatilityResult {
  volatilityPct:    number;
  priceNow:         number;
  price24hAgo:      number;
  source:           "uniswap_twap";
}

/**
 * Compute 24h WETH price volatility from Uniswap V3 TWAP.
 *
 * Returns null if pool is not configured or RPC fails.
 * The circuit breaker passes this directly to `volatilityPct`.
 *
 * @example
 * const vol = await fetchVolatility24h();
 * // vol = { volatilityPct: 3.7, priceNow: 3200, price24hAgo: 3082 }
 */
export async function fetchVolatility24h(): Promise<VolatilityResult | null> {
  const poolAddr = process.env.UNISWAP_USDC_WETH_POOL as Address | undefined;

  if (!poolAddr) {
    logger.info("volatilityOracle: UNISWAP_USDC_WETH_POOL not configured — skipping");
    return null;
  }

  try {
    // Observe at [86400 seconds ago, 0 seconds ago (now)]
    const [tickCumulatives] = await publicClient.readContract(({
      address:      poolAddr,
      abi:          UNISWAP_OBSERVE_ABI,
      functionName: "observe",
      args:         [[86400, 0]],
    } as any)) as [bigint[], unknown[]];

    if (!tickCumulatives || tickCumulatives.length < 2) {
      logger.warn("volatilityOracle: unexpected observe() return length");
      return null;
    }

    // Convert bigint accumulators to number (safe — tick values fit in JS float)
    const tick24hAgo = Number(tickCumulatives[0]);
    const tickNow    = Number(tickCumulatives[1]);

    // Arithmetic mean tick over the 24h window
    const meanTick24hAgo = tick24hAgo / 1;   // it IS the 24h-ago cumulative snapshot
    const meanTickNow    = tickNow    / 1;

    // The delta between them divided by elapsed seconds = time-weighted mean tick
    const SECONDS = 86400;
    const meanTick = (meanTickNow - meanTick24hAgo) / SECONDS;

    // Price at current mean tick
    const priceNow    = tickToPrice(meanTick);

    // Price 24h ago: derive from the earlier accumulator reading at that single point
    // Since observe() returns cumulative sums, price at the exact 24h-ago point:
    const priceAtSnapshot = tickToPrice(tick24hAgo / SECONDS);

    // Absolute 24h return as percentage
    const volatilityPct = Math.abs(priceNow - priceAtSnapshot) / priceAtSnapshot * 100;

    // Sanity: WETH should be between $100 and $100k
    if (priceNow < 100 || priceNow > 100_000) {
      logger.warn("volatilityOracle: WETH price out of expected bounds", { priceNow });
      return null;
    }

    logger.info("volatilityOracle: 24h WETH volatility", {
      priceNow:      priceNow.toFixed(2),
      priceAtSnapshot: priceAtSnapshot.toFixed(2),
      volatilityPct: volatilityPct.toFixed(2),
    });

    return {
      volatilityPct,
      priceNow,
      price24hAgo: priceAtSnapshot,
      source:      "uniswap_twap",
    };
  } catch (err) {
    logger.warn("volatilityOracle: observe() failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
