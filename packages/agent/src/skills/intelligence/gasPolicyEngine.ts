/**
 * gasPolicyEngine
 *
 * Prevents the agent from executing transactions during periods of
 * abnormally high gas prices, protecting users from inflated fees.
 *
 * CELO/USD source (production-hardened):
 *   Mento Broker getAmountOut(CELO_TOKEN, USDm, 1e18).
 *   Falls back to CELO_PRICE_USD env var only if Mento call fails.
 *   The previous static env-var-only approach is removed.
 *
 * Env overrides:
 *   MAX_GAS_PRICE_GWEI      (default 50)
 *   MAX_GAS_COST_USD        (default 0.50)
 *   CELO_PRICE_USD          (emergency fallback only, default 0.75)
 *   TYPICAL_REBALANCE_GAS   (default 300000)
 *   CELO_TOKEN_ADDRESS      (override GoldToken address if needed)
 */

import {
  createPublicClient,
  http,
  formatUnits,
  parseUnits,
  type Address,
} from "viem";
import { activeChain, CHAIN_ID } from "@piggy/config/chains";
import { getProtocolAddress }    from "@piggy/config/protocols";
import { getTokenAddress }       from "@piggy/config/tokens";
import { logger }                from "@piggy/shared";

// ── Types ─────────────────────────────────────────────────────────────────

export interface GasPolicyResult {
  allowed:          boolean;
  gasPriceGwei:     number;
  celoPriceUSD:     number;
  estimatedGasUSD:  number;
  /** True when celoPriceUSD came from env fallback, not the live oracle */
  celoPriceIsStale: boolean;
  reason:           string;
}

// ── Config ────────────────────────────────────────────────────────────────

const MAX_GAS_PRICE_GWEI      = parseFloat(process.env.MAX_GAS_PRICE_GWEI ?? "50");
const MAX_GAS_COST_USD        = parseFloat(process.env.MAX_GAS_COST_USD   ?? "0.50");
const CELO_PRICE_USD_FALLBACK = parseFloat(process.env.CELO_PRICE_USD     ?? "0.75");
const TYPICAL_REBALANCE_GAS   = BigInt(process.env.TYPICAL_REBALANCE_GAS  ?? "300000");

const publicClient = createPublicClient({ chain: activeChain, transport: http() });

// ── Mento ABI ─────────────────────────────────────────────────────────────

const MENTO_AMOUNT_OUT_ABI = [{
  name: "getAmountOut", type: "function",
  inputs: [
    { name: "tokenIn",  type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" },
  ],
  outputs: [{ name: "", type: "uint256" }],
  stateMutability: "view",
}] as const;

/**
 * GoldToken (ERC-20 wrapper of native CELO used by Mento).
 *   Mainnet:  0x471EcE3750Da237f93B8E339c536989b8978a438
 *   Sepolia:  0xF194afDf50B03e69Bd7D057c1Aa9e10c9954E4C
 */
const CELO_TOKEN_ADDRESS = (
  process.env.CELO_TOKEN_ADDRESS as Address | undefined
) ?? (CHAIN_ID === 42220
  ? "0x471EcE3750Da237f93B8E339c536989b8978a438"
  : "0xF194afDf50B03e69Bd7D057c1Aa9e10c9954E4C"
) as Address;

// ── Live CELO/USD oracle ───────────────────────────────────────────────────

/**
 * Fetch live CELO/USD price from Mento broker.
 * Query: how many USDm does 1 CELO buy?
 * Exported so gasPolicyEngine tests can mock it.
 */
export async function fetchCeloPriceFromMento(): Promise<number | null> {
  try {
    const mentoAddr = getProtocolAddress(CHAIN_ID, "mentoBroker");
    const usdmAddr  = getTokenAddress(CHAIN_ID, "USDm");

    const amountOut = await publicClient.readContract(({
      address:      mentoAddr,
      abi:          MENTO_AMOUNT_OUT_ABI,
      functionName: "getAmountOut",
      args:         [CELO_TOKEN_ADDRESS, usdmAddr, parseUnits("1", 18)],
    } as any)) as bigint;

    const price = parseFloat(formatUnits(amountOut, 18));
    if (price < 0.01 || price > 100) {
      logger.warn("gasPolicyEngine: CELO price out of expected bounds", { price });
      return null;
    }
    logger.info("gasPolicyEngine: CELO/USD", { price: price.toFixed(4), source: "mento" });
    return price;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("not configured")) {
      logger.warn("gasPolicyEngine: Mento CELO price read failed", { error: msg });
    }
    return null;
  }
}

// ── Main export ────────────────────────────────────────────────────────────

export async function evaluateGasPolicy(): Promise<GasPolicyResult> {
  const [gasPriceSettled, celoPriceSettled] = await Promise.allSettled([
    publicClient.getGasPrice(),
    fetchCeloPriceFromMento(),
  ]);

  if (gasPriceSettled.status === "rejected") {
    logger.warn("gasPolicyEngine: could not fetch gas price — allowing execution");
    return {
      allowed: true, gasPriceGwei: 0,
      celoPriceUSD: CELO_PRICE_USD_FALLBACK, estimatedGasUSD: 0,
      celoPriceIsStale: true,
      reason: "Gas price fetch failed — execution allowed with unknown gas cost.",
    };
  }

  const gasPriceWei      = gasPriceSettled.value;
  const gasPriceGwei     = parseFloat(formatUnits(gasPriceWei, 9));
  const liveCelo         = celoPriceSettled.status === "fulfilled" ? celoPriceSettled.value : null;
  const celoPriceUSD     = liveCelo ?? CELO_PRICE_USD_FALLBACK;
  const celoPriceIsStale = liveCelo === null;

  if (celoPriceIsStale) {
    logger.warn("gasPolicyEngine: using fallback CELO/USD", { value: celoPriceUSD });
  }

  const gasCostWei      = gasPriceWei * TYPICAL_REBALANCE_GAS;
  const gasCostCelo     = parseFloat(formatUnits(gasCostWei, 18));
  const estimatedGasUSD = gasCostCelo * celoPriceUSD;

  const overGwei = gasPriceGwei    > MAX_GAS_PRICE_GWEI;
  const overUSD  = estimatedGasUSD > MAX_GAS_COST_USD;
  const allowed  = !overGwei && !overUSD;

  const celoTag = celoPriceIsStale ? " [fallback]" : "";
  const reason  = allowed
    ? `Gas OK: ${gasPriceGwei.toFixed(2)} gwei / ~$${estimatedGasUSD.toFixed(4)} (CELO=$${celoPriceUSD.toFixed(4)}${celoTag}).`
    : `Gas too high: ${gasPriceGwei.toFixed(2)} gwei / ~$${estimatedGasUSD.toFixed(4)}. Limits: ${MAX_GAS_PRICE_GWEI} gwei / $${MAX_GAS_COST_USD}. Deferring.`;

  logger.info("gasPolicyEngine", {
    gasPriceGwei: gasPriceGwei.toFixed(2),
    celoPriceUSD: celoPriceUSD.toFixed(4),
    celoPriceIsStale, estimatedGasUSD: estimatedGasUSD.toFixed(4), allowed,
  });

  return { allowed, gasPriceGwei, celoPriceUSD, estimatedGasUSD, celoPriceIsStale, reason };
}
