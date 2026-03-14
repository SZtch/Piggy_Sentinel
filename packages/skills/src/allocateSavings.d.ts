import type { SkillResult } from "@piggy/shared";
import { type Address } from "viem";
export interface TxCalldata {
    to: Address;
    data: `0x${string}`;
    /** Native CELO value — always 0n for ERC-20 operations */
    value: bigint;
    /** Human-readable description for logging */
    description?: string;
}
export interface AllocateSavingsInput {
    userWallet: string;
    totalAmount: bigint;
    executorAddress: string;
}
export interface AllocateSavingsOutput {
    swaps: TxCalldata[];
    supplies: TxCalldata[];
    breakdown: {
        usdt: bigint;
        usdc: bigint;
        usdm: bigint;
    };
}
/**
 * Multi-stablecoin allocation strategy.
 *
 * User transfers USDm → agent splits and supplies to Aave:
 *   60% → swap USDm to USDT → supply USDT to Aave (8.89% APY)
 *   30% → swap USDm to USDC → supply USDC to Aave (2.61% APY)
 *   10% → keep as USDm     → supply USDm to Aave (1.07% APY)
 *
 * Blended APY: ~6.22%
 */
export declare function allocateSavings(input: AllocateSavingsInput): Promise<SkillResult<AllocateSavingsOutput>>;
//# sourceMappingURL=allocateSavings.d.ts.map