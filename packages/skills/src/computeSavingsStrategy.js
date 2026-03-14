import { HARDCODED_STRATEGY } from "@piggy/shared";
import { logger } from "@piggy/shared";
export async function computeSavingsStrategy(input) {
    try {
        if (input.useOpenClaw) {
            // OpenClaw integration point — packages/agent/src/opclaw.ts
            // Falls back silently when not configured
            logger.info("computeSavingsStrategy: OpenClaw path requested but not yet integrated — using hardcoded");
        }
        if (input.walletBalance === 0n) {
            return { success: false, data: null, error: "Wallet balance is zero", txHash: null, agentscanEventId: null, executedAt: new Date() };
        }
        const allocationAmount = input.walletBalance < input.targetAmount
            ? input.walletBalance
            : input.targetAmount;
        const output = {
            allocationAmount,
            expectedApyMin: HARDCODED_STRATEGY.expectedApyMin,
            expectedApyMax: HARDCODED_STRATEGY.expectedApyMax,
            fxHedgeThresholdPct: HARDCODED_STRATEGY.fxHedgeThresholdPct,
            monitorCadenceHours: HARDCODED_STRATEGY.monitorCadenceHours,
            confidenceScore: HARDCODED_STRATEGY.confidenceScore,
            source: "hardcoded",
        };
        return { success: true, data: output, error: null, txHash: null, agentscanEventId: null, executedAt: new Date() };
    }
    catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return { success: false, data: null, error, txHash: null, agentscanEventId: null, executedAt: new Date() };
    }
}
