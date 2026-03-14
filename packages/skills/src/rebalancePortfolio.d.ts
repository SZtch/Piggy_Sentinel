import type { SkillResult } from "@piggy/shared";
import type { TxCalldata } from "./allocateSavings.js";
export interface CurrentApys {
    usdt: number;
    usdc: number;
    usdm: number;
}
export interface CurrentAllocations {
    usdt: bigint;
    usdc: bigint;
    usdm: bigint;
}
export interface RebalanceInput {
    userWallet: string;
    executorAddress: string;
    currentApys: CurrentApys;
    currentAllocations: CurrentAllocations;
    totalPortfolioValue: bigint;
    lastRebalancedAt: Date | null;
    estimatedGasCostUSD: number;
}
export interface RebalanceOutput {
    shouldRebalance: boolean;
    skipReason?: string;
    newAllocBps: {
        usdt: number;
        usdc: number;
        usdm: number;
    };
    estimatedNewApy: number;
    calldata: TxCalldata[];
}
/**
 * Rebalance portfolio when APY shifts significantly.
 *
 * Guardrails (all must pass):
 *   1. Portfolio value >= MIN_REBALANCE_AMOUNT
 *   2. Not rebalanced in last 24h
 *   3. APY changed > 2% from current blended
 *   4. Gas cost < 10% of expected yield
 */
export declare function rebalancePortfolio(input: RebalanceInput): Promise<SkillResult<RebalanceOutput>>;
//# sourceMappingURL=rebalancePortfolio.d.ts.map