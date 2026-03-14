/**
 * Checks FX drift between held asset and goal currency.
 * Uses x402 when USE_X402_FOR_FX=true, otherwise Mento oracle (default).
 * Drift is measured against the baseline rate stored at goal activation.
 */
import type { SkillResult } from "@piggy/shared";
import { logger } from "@piggy/shared";
import { mento } from "@piggy/adapters";
import type { TokenSymbol } from "@piggy/config/tokens";
import type { CheckFxDriftInput, CheckFxDriftOutput } from "./types.js";

async function fetchFxRate(from: string, to: string): Promise<{ rate: number; source: "x402" | "mento_oracle" }> {
  if (process.env.USE_X402_FOR_FX === "true") {
    // ── x402 integration boundary ─────────────────────────────────────────
    // TODO: implement x402 micropayment + rate fetch
    // See packages/agent/src/opclaw.ts for HTTP client pattern.
    // For now fall through to Mento oracle.
    logger.warn("checkFxDrift: x402 not yet implemented — using Mento oracle");
  }

  const rate = await mento.getMentoFxRate(from as TokenSymbol, to as TokenSymbol);
  return { rate, source: "mento_oracle" };
}

export async function checkFxDrift(
  input: CheckFxDriftInput
): Promise<SkillResult<CheckFxDriftOutput>> {
  try {
    if (input.heldAsset === input.goalCurrency) {
      return {
        success: true,
        data: { currentDriftPct: 0, currentFxRate: 1.0, hedgeRequired: false, recommendedSwapAmount: 0n, fxRateSource: "mento_oracle" },
        error: null, txHash: null, agentscanEventId: null, executedAt: new Date(),
      };
    }

    const { rate, source } = await fetchFxRate(input.heldAsset, input.goalCurrency);

    // Drift is measured from the baseline rate captured at goal activation
    const driftPct      = Math.abs((rate - input.baselineFxRate) / input.baselineFxRate) * 100;
    const hedgeRequired = driftPct >= input.hedgeThresholdPct;

    logger.info("checkFxDrift", { pair: `${input.heldAsset}/${input.goalCurrency}`, driftPct: driftPct.toFixed(3), hedgeRequired });

    return {
      success: true,
      data: {
        currentDriftPct:       driftPct,
        currentFxRate:         rate,
        hedgeRequired,
        recommendedSwapAmount: hedgeRequired ? input.heldAmount : 0n,
        fxRateSource:          source,
      },
      error: null, txHash: null, agentscanEventId: null, executedAt: new Date(),
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error("checkFxDrift failed", error);
    return { success: false, data: null, error, txHash: null, agentscanEventId: null, executedAt: new Date() };
  }
}
