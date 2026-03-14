import type { SkillResult } from "@piggy/shared";

export type Skill<I, O> = (input: I) => Promise<SkillResult<O>>;

// computeSavingsStrategy
export interface ComputeStrategyInput {
  targetAmount:   bigint;
  targetCurrency: string;
  deadlineDays:   number;
  walletBalance:  bigint;
  useOpenClaw:    boolean;
}
export interface ComputeStrategyOutput {
  allocationAmount:    bigint;
  expectedApyMin:      number;
  expectedApyMax:      number;
  fxHedgeThresholdPct: number;
  monitorCadenceHours: number;
  confidenceScore:     number;
  source:              "openclaw" | "hardcoded";
}

// checkGoalProgress
export interface CheckProgressInput {
  agentWalletAddress: string;
  goalTargetAmount:   bigint;
  goalCurrency:       string;
  deadlineDays:       number;
}
export interface CheckProgressOutput {
  currentBalance:           bigint;
  progressPct:              number;
  paceStatus:               "on_track" | "behind" | "ahead";
  projectedValueAtDeadline: bigint;
  shouldAlert:              boolean;
}

// checkFxDrift
export interface CheckFxDriftInput {
  heldAsset:          string;
  goalCurrency:       string;
  heldAmount:         bigint;
  baselineFxRate:     number;  // rate at goal activation
  hedgeThresholdPct:  number;
}
export interface CheckFxDriftOutput {
  currentDriftPct:        number;
  currentFxRate:          number;
  hedgeRequired:          boolean;
  recommendedSwapAmount:  bigint;
  fxRateSource:           "x402" | "mento_oracle";
}

// allocateSavings
export interface AllocateSavingsInput {
  agentWalletAddress: string;
  asset:              string;   // on-chain address
  amount:             bigint;
  executorAddress:    string;
}

// hedgeFxExposure
export interface HedgeFxExposureInput {
  agentWalletAddress: string;
  fromAsset:          string;  // symbol: "USDm"
  toAsset:            string;  // symbol: "EURm"
  swapAmount:         bigint;
  maxSlippagePct:     number;
  executorAddress:    string;
}
