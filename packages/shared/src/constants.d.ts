/** How often the agent runs per goal. Default: 6 hours */
export declare const AGENT_CYCLE_INTERVAL_MS: number;
/** Free Penny chat messages per wallet per month before x402 kicks in */
export declare const FREE_CHAT_LIMIT_PER_MONTH = 30;
/** Link code expires after 10 minutes */
export declare const TELEGRAM_LINK_CODE_TTL_MS: number;
/** Default 60% to USDT (highest APY) */
export declare const ALLOC_USDT_BPS = 6000;
/** Default 30% to USDC (mid APY) */
export declare const ALLOC_USDC_BPS = 3000;
/** Default 10% to USDm (lowest APY, base currency) */
export declare const ALLOC_USDM_BPS = 1000;
/** Blended APY at default allocation: 0.6*8.89 + 0.3*2.61 + 0.1*1.07 ≈ 6.22% */
export declare const BLENDED_APY_PCT = 6.22;
/** Minimum portfolio value (USD) to trigger a rebalance */
export declare const MIN_REBALANCE_AMOUNT = 10;
/** Minimum Aave supply amount (USD) — below this, don't supply */
export declare const MIN_AAVE_SUPPLY_AMOUNT = 1;
/** Don't rebalance more often than this */
export declare const MAX_REBALANCE_INTERVAL_MS: number;
/** APY must drift by at least this % from current blended before rebalancing */
export declare const APY_CHANGE_THRESHOLD_PCT = 2;
/** Max allocation shift per rebalance cycle (BPS) — prevents dramatic swings */
export declare const MAX_ALLOCATION_SHIFT_BPS = 2000;
/** Gas cost must not exceed this % of expected annualised yield */
export declare const MAX_GAS_TO_YIELD_RATIO_PCT = 10;
/** Used when OpenClaw is not configured */
export declare const HARDCODED_STRATEGY: {
    readonly expectedApyMin: 5.5;
    readonly expectedApyMax: 9.5;
    readonly fxHedgeThresholdPct: 5;
    readonly monitorCadenceHours: 6;
    readonly confidenceScore: 0.75;
};
/**
 * Approval multiplier — agent is approved to spend up to 2× the target amount.
 * Covers rebalancing swaps (e.g. full USDT→USDm→USDC round trip) without
 * requiring a new approval mid-cycle.
 */
export declare const APPROVAL_MULTIPLIER = 2n;
//# sourceMappingURL=constants.d.ts.map