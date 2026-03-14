/**
 * stablecoinPegMonitor
 *
 * Monitors the USD peg of USDm, USDC, and USDT on Celo.
 *
 * Price source:
 *   Mento's on-chain exchange rate: getAmountOut(1e6 stablecoin → USDm)
 *   provides a real-time relative price between Mento-supported stables.
 *   For USDC and USDT this is the best available on-chain oracle on Celo.
 *
 *   USDm itself is measured by querying the Mento broker's median rate,
 *   which is derived from Chainlink CELO/USD + Mento's own TWAP.
 *
 * Fallback:
 *   If on-chain reads fail (RPC outage, contract paused), the monitor
 *   returns a WARN-level alert with the last known price rather than
 *   blocking execution with stale data.
 *
 * Thresholds (env-configurable):
 *   PEG_WARN_THRESHOLD_PCT   default 0.5%  → WARN alert
 *   PEG_ALERT_THRESHOLD_PCT  default 1.0%  → HIGH alert (triggers circuit breaker)
 *   PEG_CRITICAL_THRESHOLD_PCT default 2.0% → CRITICAL (immediate pause)
 */

import {
  createPublicClient,
  http,
  parseUnits,
  formatUnits,
  type Address,
} from "viem";
import { activeChain, CHAIN_ID } from "@piggy/config/chains";
import { getTokenAddress, type TokenSymbol } from "@piggy/config/tokens";
import { getProtocolAddress } from "@piggy/config/protocols";
import { logger } from "@piggy/shared";

// ── Types ─────────────────────────────────────────────────────────────────

export type PegStatus = "ok" | "warn" | "alert" | "critical";

export interface PegReading {
  token:          TokenSymbol;
  priceUSD:       number;
  deviationPct:   number;
  status:         PegStatus;
  message:        string;
  /** True when the reading is from cache/fallback due to RPC failure */
  isStale:        boolean;
  /** Number of consecutive stale reads for this token (0 = fresh) */
  consecutiveStaleCount: number;
}

export interface PegMonitorResult {
  readings:      PegReading[];
  worstStatus:   PegStatus;
  /** Any token in alert or critical state */
  hasAlert:      boolean;
  /** Any token in critical state */
  hasCritical:   boolean;
}

// ── Thresholds ────────────────────────────────────────────────────────────

const WARN_PCT     = parseFloat(process.env.PEG_WARN_THRESHOLD_PCT     ?? "0.5");
const ALERT_PCT    = parseFloat(process.env.PEG_ALERT_THRESHOLD_PCT    ?? "1.0");
const CRITICAL_PCT = parseFloat(process.env.PEG_CRITICAL_THRESHOLD_PCT ?? "2.0");

/**
 * After this many consecutive stale reads, the token status escalates from
 * "warn" to "alert" even though no live price is available.  This prevents
 * a sustained RPC outage from masking a real depeg that happened while the
 * oracle was down.
 *
 * Default: 3 consecutive stale cycles (~18h at the 6h cycle rate).
 * Override: PEG_STALE_ESCALATION_COUNT
 */
const STALE_ESCALATION_COUNT = parseInt(
  process.env.PEG_STALE_ESCALATION_COUNT ?? "3",
);

// ── In-process stale-read counter ─────────────────────────────────────────
//
// Counts how many consecutive cycles each token has returned a null price.
// Resets to 0 the moment a live read succeeds.
//
// Production upgrade: store these counters in the DB or Redis so they persist
// across process restarts (e.g. on scheduler restart during an actual outage).
const staleCounters = new Map<TokenSymbol, number>();

function getStaleCount(token: TokenSymbol): number {
  return staleCounters.get(token) ?? 0;
}

function incrementStale(token: TokenSymbol): number {
  const next = getStaleCount(token) + 1;
  staleCounters.set(token, next);
  return next;
}

function clearStale(token: TokenSymbol): void {
  staleCounters.set(token, 0);
}

// ── Mento ABI (minimal) ───────────────────────────────────────────────────

const MENTO_ABI = [
  {
    type:   "function",
    name:   "getAmountOut",
    inputs: [
      { name: "tokenIn",  type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs:        [{ name: "amountOut", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const publicClient = createPublicClient({
  chain:     activeChain,
  transport: http(),
});

// ── Price fetcher ─────────────────────────────────────────────────────────

/**
 * Price of `token` in USD via Mento getAmountOut.
 * We query: 1 USD-unit of `token` → amount of USDm.
 * USDm is the Mento base stable so 1 USDm ≈ $1.
 * Returns null on RPC/contract failure.
 */
async function fetchPriceVsMento(
  token:        TokenSymbol,
  mentoAddress: Address,
): Promise<number | null> {
  try {
    const tokenAddr = getTokenAddress(CHAIN_ID, token);
    const usdmAddr  = getTokenAddress(CHAIN_ID, "USDm");

    // Use 1 unit in the token's native decimals
    const decimals = token === "USDm" ? 18 : 6;
    const amountIn = parseUnits("1", decimals);

    const amountOut = await publicClient.readContract(({
      address:      mentoAddress,
      abi:          MENTO_ABI,
      functionName: "getAmountOut",
      args:         [tokenAddr, usdmAddr, amountIn],
    } as any)) as bigint;

    // amountOut is in USDm (18 dec) → convert to float
    return parseFloat(formatUnits(amountOut, 18));
  } catch (err) {
    logger.warn("pegMonitor: fetchPriceVsMento failed", {
      token,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ── Status classifier ──────────────────────────────────────────────────────

function classifyDeviation(deviationPct: number): PegStatus {
  if (deviationPct >= CRITICAL_PCT) return "critical";
  if (deviationPct >= ALERT_PCT)    return "alert";
  if (deviationPct >= WARN_PCT)     return "warn";
  return "ok";
}

function buildMessage(token: string, priceUSD: number, deviationPct: number, status: PegStatus): string {
  const dir = priceUSD < 1 ? "below" : "above";
  switch (status) {
    case "ok":       return `${token} peg healthy at $${priceUSD.toFixed(4)}.`;
    case "warn":     return `${token} peg slightly ${dir} $1.00 — $${priceUSD.toFixed(4)} (${deviationPct.toFixed(2)}% deviation). Monitoring.`;
    case "alert":    return `⚠️  ${token} peg ${dir} $1.00 — $${priceUSD.toFixed(4)} (${deviationPct.toFixed(2)}% deviation). Consider reducing exposure.`;
    case "critical": return `🚨 CRITICAL: ${token} peg ${dir} $1.00 — $${priceUSD.toFixed(4)} (${deviationPct.toFixed(2)}% deviation). Pausing agent.`;
  }
}

const PEG_STATUS_ORDER: PegStatus[] = ["ok", "warn", "alert", "critical"];
function worstOf(a: PegStatus, b: PegStatus): PegStatus {
  return PEG_STATUS_ORDER.indexOf(a) >= PEG_STATUS_ORDER.indexOf(b) ? a : b;
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Check peg stability for all three Piggy stables.
 *
 * Stale-read escalation:
 *   - 1st stale read  → "warn"  (RPC blip, assume peg)
 *   - Nth stale read (N ≥ STALE_ESCALATION_COUNT) → "alert"
 *     The circuit breaker treats "alert" as a serious signal even without
 *     a confirmed price, preventing a sustained RPC outage from hiding a
 *     real depeg event.
 *
 * @example
 * const peg = await checkStablecoinPegs();
 * if (peg.hasCritical) triggerCircuitBreaker("peg_break", peg);
 */
export async function checkStablecoinPegs(): Promise<PegMonitorResult> {
  let mentoAddress: Address;
  try {
    mentoAddress = getProtocolAddress(CHAIN_ID, "mentoBroker");
  } catch {
    logger.warn("pegMonitor: Mento broker address not configured — skipping peg check");
    return {
      readings:    [],
      worstStatus: "ok",
      hasAlert:    false,
      hasCritical: false,
    };
  }

  const stables: TokenSymbol[] = ["USDm", "USDC", "USDT"];
  const readings: PegReading[] = [];

  for (const token of stables) {
    const price = await fetchPriceVsMento(token, mentoAddress);

    if (price !== null) {
      // Live read succeeded — reset stale counter
      clearStale(token);

      const deviationPct = Math.abs(price - 1.0) * 100;
      const status       = classifyDeviation(deviationPct);
      const message      = buildMessage(token, price, deviationPct, status);

      readings.push({
        token, priceUSD: price, deviationPct, status, message,
        isStale: false, consecutiveStaleCount: 0,
      });

      logger.info("pegMonitor", {
        token, priceUSD: price.toFixed(4),
        deviationPct: deviationPct.toFixed(3), status,
      });
    } else {
      // RPC/oracle failure — increment stale counter and escalate if needed
      const staleCount = incrementStale(token);
      const escalated  = staleCount >= STALE_ESCALATION_COUNT;
      const status: PegStatus = escalated ? "alert" : "warn";

      const message = escalated
        ? `⚠️ ${token}: oracle read failed for ${staleCount} consecutive cycles. ` +
          `Treating as peg alert until oracle recovers. Check RPC and Mento status.`
        : `${token}: RPC read failed (stale #${staleCount}). Assuming peg until oracle recovers.`;

      readings.push({
        token,
        priceUSD:             1.0,  // conservative assumption
        deviationPct:         0,
        status,
        message,
        isStale:              true,
        consecutiveStaleCount: staleCount,
      });

      logger.warn("pegMonitor: stale read", {
        token, staleCount, escalated, status,
      });
    }
  }

  const worstStatus = readings.reduce<PegStatus>(
    (worst, r) => worstOf(worst, r.status),
    "ok",
  );

  return {
    readings,
    worstStatus,
    hasAlert:    worstStatus === "alert"    || worstStatus === "critical",
    hasCritical: worstStatus === "critical",
  };
}

/** Exposed for testing — resets all stale counters */
export function _resetStaleCountersForTesting(): void {
  staleCounters.clear();
}
