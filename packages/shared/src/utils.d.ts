/**
 * Generate a random 6-character alphanumeric code for Telegram linking.
 * E.g. "X7K2P9"
 */
export declare function generateCode(): string;
/**
 * Compute ERC-20 approval amount for agent spend limit.
 * Agent is approved for APPROVAL_MULTIPLIER × targetAmount to cover
 * rebalancing swaps without needing a new approval mid-cycle.
 *
 * @param targetAmount - goal target in token's native decimals (bigint)
 * @returns approval amount as bigint
 */
export declare function calcApprovalAmount(targetAmount: bigint): bigint;
/**
 * Format a bigint token amount for logging.
 * @param amount - raw token amount
 * @param decimals - token decimals (6 for USDC/USDT, 18 for USDm)
 * @param symbol - token symbol for display
 */
export declare function formatTokenAmount(amount: bigint, decimals: number, symbol: string): string;
/**
 * Sleep for a given number of milliseconds.
 * Useful in retry loops or polling.
 */
export declare function sleep(ms: number): Promise<void>;
/**
 * Retry an async operation up to `attempts` times with exponential backoff.
 */
export declare function withRetry<T>(fn: () => Promise<T>, attempts?: number, baseMs?: number): Promise<T>;
/**
 * Truncate an Ethereum address for display: "0x1234...abcd"
 */
export declare function shortAddress(address: string): string;
//# sourceMappingURL=utils.d.ts.map