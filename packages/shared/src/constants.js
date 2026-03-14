// ─────────────────────────────────────────────────────────────────────────────
// @piggy/shared — Constants
// All tuneable values live here. Never hardcode these in service code.
// ─────────────────────────────────────────────────────────────────────────────
// ── Scheduler ─────────────────────────────────────────────────────────────────
/** How often the agent runs per goal. Default: 6 hours */
export const AGENT_CYCLE_INTERVAL_MS = 6 * 60 * 60 * 1_000;
// ── Chat / x402 ───────────────────────────────────────────────────────────────
/** Free Penny chat messages per wallet per month before x402 kicks in */
export const FREE_CHAT_LIMIT_PER_MONTH = 30;
// ── Telegram ──────────────────────────────────────────────────────────────────
/** Link code expires after 10 minutes */
export const TELEGRAM_LINK_CODE_TTL_MS = 10 * 60 * 1_000;
// ── Allocation strategy (basis points, BPS = 10_000) ─────────────────────────
/** Default 60% to USDT (highest APY) */
export const ALLOC_USDT_BPS = 6_000;
/** Default 30% to USDC (mid APY) */
export const ALLOC_USDC_BPS = 3_000;
/** Default 10% to USDm (lowest APY, base currency) */
export const ALLOC_USDM_BPS = 1_000;
/** Blended APY at default allocation: 0.6*8.89 + 0.3*2.61 + 0.1*1.07 ≈ 6.22% */
export const BLENDED_APY_PCT = 6.22;
// ── Rebalance guardrails ───────────────────────────────────────────────────────
/** Minimum portfolio value (USD) to trigger a rebalance */
export const MIN_REBALANCE_AMOUNT = 10; // $10 USD
/** Minimum Aave supply amount (USD) — below this, don't supply */
export const MIN_AAVE_SUPPLY_AMOUNT = 1; // $1 USD
/** Don't rebalance more often than this */
export const MAX_REBALANCE_INTERVAL_MS = 24 * 60 * 60 * 1_000; // 24h
/** APY must drift by at least this % from current blended before rebalancing */
export const APY_CHANGE_THRESHOLD_PCT = 2.0;
/** Max allocation shift per rebalance cycle (BPS) — prevents dramatic swings */
export const MAX_ALLOCATION_SHIFT_BPS = 2_000; // 20%
/** Gas cost must not exceed this % of expected annualised yield */
export const MAX_GAS_TO_YIELD_RATIO_PCT = 10.0;
// ── Hardcoded fallback strategy ───────────────────────────────────────────────
/** Used when OpenClaw is not configured */
export const HARDCODED_STRATEGY = {
    expectedApyMin: 5.5,
    expectedApyMax: 9.5,
    fxHedgeThresholdPct: 5.0,
    monitorCadenceHours: 6,
    confidenceScore: 0.75,
};
// ── Approval ──────────────────────────────────────────────────────────────────
/**
 * Approval multiplier — agent is approved to spend up to 2× the target amount.
 * Covers rebalancing swaps (e.g. full USDT→USDm→USDC round trip) without
 * requiring a new approval mid-cycle.
 */
export const APPROVAL_MULTIPLIER = 2n;
