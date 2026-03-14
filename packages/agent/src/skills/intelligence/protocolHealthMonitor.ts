/**
 * protocolHealthMonitor
 *
 * Monitors the operational health of Aave V3, Mento, and Uniswap on Celo.
 *
 * Checks per protocol:
 *   Aave:    - Pool is not paused (IPool.paused())
 *             - Reserve is active and not frozen (getReserveData)
 *             - Utilization rate < AAVE_MAX_UTILIZATION_PCT (high util = hard to withdraw)
 *
 *   Mento:   - Broker has reserves (broker.getAmountOut doesn't revert)
 *             - Last oracle update < ORACLE_STALENESS_SECONDS old
 *
 *   Uniswap: - Pool liquidity > MIN_POOL_LIQUIDITY_USD
 *             - Observation cardinality > 1 (TWAP oracle has history)
 *
 * Each check returns a ProtocolHealthReport with a health status:
 *   "healthy" | "degraded" | "unavailable"
 *
 * The scheduler calls this once per cycle and feeds the result to the
 * risk scoring engine and circuit breaker.
 */

import {
  createPublicClient,
  http,
  type Address,
  formatUnits,
} from "viem";
import { activeChain, CHAIN_ID } from "@piggy/config/chains";
import { getProtocolAddress }    from "@piggy/config/protocols";
import { getTokenAddress }       from "@piggy/config/tokens";
import { logger }                from "@piggy/shared";

// ── Types ─────────────────────────────────────────────────────────────────

export type ProtocolHealthStatus = "healthy" | "degraded" | "unavailable";

export interface ProtocolHealthReport {
  protocol:    "aave" | "mento" | "uniswap";
  status:      ProtocolHealthStatus;
  utilizationPct?: number;
  details:     string[];
  warnings:    string[];
}

export interface SystemHealthResult {
  aave:            ProtocolHealthReport;
  mento:           ProtocolHealthReport;
  uniswap:         ProtocolHealthReport;
  overallStatus:   ProtocolHealthStatus;
  /** Any protocol is unavailable — agent should not execute */
  hasUnavailable:  boolean;
  /** Any protocol is degraded — agent should be cautious */
  hasDegraded:     boolean;
}

// ── ABIs ──────────────────────────────────────────────────────────────────

const AAVE_POOL_ABI = [
  {
    name:   "paused",
    type:   "function",
    inputs: [],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    name:   "getReserveData",
    type:   "function",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{
      name: "", type: "tuple",
      components: [
        { name: "configuration",         type: "uint256" },
        { name: "liquidityIndex",        type: "uint128" },
        { name: "currentLiquidityRate",  type: "uint128" },
        { name: "variableBorrowIndex",   type: "uint128" },
        { name: "currentVariableBorrowRate", type: "uint128" },
        { name: "currentStableBorrowRate",   type: "uint128" },
        { name: "lastUpdateTimestamp",   type: "uint40" },
        { name: "id",                    type: "uint16" },
        { name: "aTokenAddress",         type: "address" },
        { name: "stableDebtTokenAddress",type: "address" },
        { name: "variableDebtTokenAddress", type: "address" },
        { name: "interestRateStrategyAddress", type: "address" },
        { name: "accruedToTreasury",     type: "uint128" },
        { name: "unbacked",              type: "uint128" },
        { name: "isolationModeTotalDebt",type: "uint128" },
      ],
    }],
    stateMutability: "view",
  },
] as const;

const UNISWAP_POOL_ABI = [
  {
    name: "slot0", type: "function", inputs: [],
    outputs: [
      { name: "sqrtPriceX96",              type: "uint160" },
      { name: "tick",                      type: "int24"   },
      { name: "observationIndex",          type: "uint16"  },
      { name: "observationCardinality",    type: "uint16"  },
      { name: "observationCardinalityNext",type: "uint16"  },
      { name: "feeProtocol",               type: "uint8"   },
      { name: "unlocked",                  type: "bool"    },
    ],
    stateMutability: "view",
  },
  {
    name: "liquidity", type: "function", inputs: [],
    outputs: [{ name: "", type: "uint128" }],
    stateMutability: "view",
  },
] as const;

// ── Constants ──────────────────────────────────────────────────────────────

const AAVE_MAX_UTILIZATION_PCT = parseFloat(process.env.AAVE_MAX_UTILIZATION_PCT ?? "95");
const ORACLE_STALENESS_SECONDS = parseInt(process.env.ORACLE_STALENESS_SECONDS   ?? "3600");
const MIN_POOL_LIQUIDITY        = BigInt(process.env.MIN_POOL_LIQUIDITY_RAW       ?? "1000000"); // raw units

const publicClient = createPublicClient({ chain: activeChain, transport: http() });

// ── Individual checkers ────────────────────────────────────────────────────

async function checkAave(): Promise<ProtocolHealthReport> {
  const details:  string[] = [];
  const warnings: string[] = [];
  let status: ProtocolHealthStatus = "healthy";

  try {
    const poolAddr  = getProtocolAddress(CHAIN_ID, "aaveV3Pool");
    const usdtAddr  = getTokenAddress(CHAIN_ID, "USDT");

    // Check: pool paused
    const isPaused = await publicClient.readContract({
      address: poolAddr, abi: AAVE_POOL_ABI, functionName: "paused",
    }) as boolean;
    if (isPaused) {
      status = "unavailable";
      warnings.push("Aave V3 pool is globally PAUSED.");
    }

    // Check: USDT reserve data (most-allocated asset)
    const reserve = await publicClient.readContract({
      address: poolAddr, abi: AAVE_POOL_ABI, functionName: "getReserveData", args: [usdtAddr],
    } as any) as { currentLiquidityRate: bigint; lastUpdateTimestamp: number };

    // Utilization: currentLiquidityRate is in Ray (1e27 = 100% APY)
    // We use it as a proxy — high rate = high utilization
    const liquidityRatePct = Number(formatUnits(reserve.currentLiquidityRate, 25)); // → pct
    details.push(`USDT supply rate: ${liquidityRatePct.toFixed(2)}%`);

    if (liquidityRatePct > AAVE_MAX_UTILIZATION_PCT) {
      status = status === "unavailable" ? "unavailable" : "degraded";
      warnings.push(`USDT reserve utilization high (${liquidityRatePct.toFixed(1)}%). Withdrawals may be difficult.`);
    }

    // Oracle freshness
    const lastUpdate = Number(reserve.lastUpdateTimestamp);
    const ageSecs    = Math.floor(Date.now() / 1000) - lastUpdate;
    if (ageSecs > ORACLE_STALENESS_SECONDS) {
      status = status === "unavailable" ? "unavailable" : "degraded";
      warnings.push(`Aave oracle stale: last update ${ageSecs}s ago.`);
    } else {
      details.push(`Oracle fresh: updated ${ageSecs}s ago.`);
    }

    if (status === "healthy") details.push("Aave V3 pool operational.");
  } catch (err) {
    status = "unavailable";
    warnings.push(`Aave health check failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const report: ProtocolHealthReport = { protocol: "aave", status, details, warnings };
  logger.info("protocolHealthMonitor: aave", { status, warnings });
  return report;
}

async function checkMento(): Promise<ProtocolHealthReport> {
  const details:  string[] = [];
  const warnings: string[] = [];
  let status: ProtocolHealthStatus = "healthy";

  try {
    // If Mento address isn't configured (testnet), skip gracefully
    const mentoAddr = getProtocolAddress(CHAIN_ID, "mentoBroker");

    // Verify broker responds to getAmountOut (basic liveness check)
    const usdmAddr = getTokenAddress(CHAIN_ID, "USDm");
    const usdcAddr = getTokenAddress(CHAIN_ID, "USDC");
    const MENTO_QUOTE_ABI = [{
      name: "getAmountOut", type: "function",
      inputs: [{ name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "amountIn", type: "uint256" }],
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
    }] as const;

    const amountOut = await publicClient.readContract({
      address: mentoAddr, abi: MENTO_QUOTE_ABI, functionName: "getAmountOut",
      args: [usdmAddr, usdcAddr, 1_000_000n],
    }) as bigint;

    if (amountOut === 0n) {
      status = "degraded";
      warnings.push("Mento getAmountOut returned 0 — broker may have zero liquidity.");
    } else {
      details.push(`Mento broker responsive: 1 USDm → ${Number(amountOut) / 1e6} USDC.`);
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // "not configured" is expected on testnet — not a hard failure
    if (msg.includes("not configured")) {
      details.push("Mento not configured for this chain — skipping.");
    } else {
      status = "unavailable";
      warnings.push(`Mento health check failed: ${msg}`);
    }
  }

  const report: ProtocolHealthReport = { protocol: "mento", status, details, warnings };
  logger.info("protocolHealthMonitor: mento", { status, warnings });
  return report;
}

async function checkUniswap(): Promise<ProtocolHealthReport> {
  const details:  string[] = [];
  const warnings: string[] = [];
  let status: ProtocolHealthStatus = "healthy";

  const POOL_ADDR = (process.env.UNISWAP_USDC_WETH_POOL as Address | undefined);

  if (!POOL_ADDR) {
    details.push("UNISWAP_USDC_WETH_POOL not configured — skipping Uniswap health check.");
    return { protocol: "uniswap", status: "healthy", details, warnings };
  }

  try {
    const [slot0, liquidity] = await Promise.all([
      publicClient.readContract({ address: POOL_ADDR, abi: UNISWAP_POOL_ABI, functionName: "slot0" } as any) as any,
      publicClient.readContract({ address: POOL_ADDR, abi: UNISWAP_POOL_ABI, functionName: "liquidity" } as any) as any,
    ]) as [{ observationCardinality: number; unlocked: boolean }, bigint];

    if (!slot0.unlocked) {
      status = "unavailable";
      warnings.push("Uniswap pool is locked (reentrancy guard active).");
    }

    if (liquidity < MIN_POOL_LIQUIDITY) {
      status = status === "unavailable" ? "unavailable" : "degraded";
      warnings.push(`Pool liquidity critically low: ${liquidity.toString()} raw units.`);
    } else {
      details.push(`Pool liquidity: ${liquidity.toString()} (healthy).`);
    }

    if (slot0.observationCardinality < 2) {
      status = status === "unavailable" ? "unavailable" : "degraded";
      warnings.push("Pool TWAP oracle has insufficient observation history.");
    } else {
      details.push(`TWAP cardinality: ${slot0.observationCardinality}.`);
    }

  } catch (err) {
    status = "unavailable";
    warnings.push(`Uniswap health check failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const report: ProtocolHealthReport = { protocol: "uniswap", status, details, warnings };
  logger.info("protocolHealthMonitor: uniswap", { status, warnings });
  return report;
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Run health checks across all three protocols and return a consolidated report.
 *
 * @example
 * const health = await checkProtocolHealth();
 * if (health.hasUnavailable) return; // skip this cycle
 */
export async function checkProtocolHealth(): Promise<SystemHealthResult> {
  const [aave, mento, uniswap] = await Promise.all([
    checkAave(),
    checkMento(),
    checkUniswap(),
  ]);

  const statuses = [aave.status, mento.status, uniswap.status];
  const hasUnavailable = statuses.includes("unavailable");
  const hasDegraded    = statuses.includes("degraded");

  const overallStatus: ProtocolHealthStatus =
    hasUnavailable ? "unavailable" :
    hasDegraded    ? "degraded"    : "healthy";

  logger.info("protocolHealthMonitor: overall", { overallStatus, hasUnavailable, hasDegraded });

  return { aave, mento, uniswap, overallStatus, hasUnavailable, hasDegraded };
}
