import type { SkillResult } from "@piggy/shared";
export type Skill<I, O> = (input: I) => Promise<SkillResult<O>>;
export interface ComputeStrategyInput {
    targetAmount: bigint;
    targetCurrency: string;
    deadlineDays: number;
    walletBalance: bigint;
    useOpenClaw: boolean;
}
export interface ComputeStrategyOutput {
    allocationAmount: bigint;
    expectedApyMin: number;
    expectedApyMax: number;
    fxHedgeThresholdPct: number;
    monitorCadenceHours: number;
    confidenceScore: number;
    source: "openclaw" | "hardcoded";
}
export interface CheckProgressInput {
    agentWalletAddress: string;
    goalTargetAmount: bigint;
    goalCurrency: string;
    deadlineDays: number;
}
export interface CheckProgressOutput {
    currentBalance: bigint;
    progressPct: number;
    paceStatus: "on_track" | "behind" | "ahead";
    projectedValueAtDeadline: bigint;
    shouldAlert: boolean;
}
export interface CheckFxDriftInput {
    heldAsset: string;
    goalCurrency: string;
    heldAmount: bigint;
    baselineFxRate: number;
    hedgeThresholdPct: number;
}
export interface CheckFxDriftOutput {
    currentDriftPct: number;
    currentFxRate: number;
    hedgeRequired: boolean;
    recommendedSwapAmount: bigint;
    fxRateSource: "x402" | "mento_oracle";
}
export interface AllocateSavingsInput {
    agentWalletAddress: string;
    asset: string;
    amount: bigint;
    executorAddress: string;
}
export interface HedgeFxExposureInput {
    agentWalletAddress: string;
    fromAsset: string;
    toAsset: string;
    swapAmount: bigint;
    maxSlippagePct: number;
    executorAddress: string;
}
//# sourceMappingURL=types.d.ts.map