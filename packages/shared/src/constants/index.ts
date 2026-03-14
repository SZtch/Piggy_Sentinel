/**
 * Piggy Sentinel — shared constants
 */

// ── Chain IDs ─────────────────────────────────────────────────────────
// IMPORTANT: must match config/chains.ts — celoSepolia.id = 11142220
export const CHAIN_ID_TESTNET = 11142220  // Celo Sepolia (active testnet)
export const CHAIN_ID_MAINNET = 42220

// ── Goal minimums ─────────────────────────────────────────────────────
export const MIN_GOAL_AMOUNT_TESTNET = 20
export const MIN_GOAL_AMOUNT_MAINNET = 100

// ── Strategy thresholds ───────────────────────────────────────────────
export const MIN_AAVE_SUPPLY_AMOUNT  = 10  // skip supply if below this
export const MIN_REBALANCE_AMOUNT    = 20  // skip rebalance if below this

// ── Aave allocation (basis points, total = 10000) ─────────────────────
// User holds USDm → agent swaps and supplies to Aave
export const ALLOC_USDT_BPS = 6000   // 60% — USDT 8.89% APY
export const ALLOC_USDC_BPS = 3000   // 30% — USDC 2.61% APY
export const ALLOC_USDM_BPS = 1000   // 10% — USDm 1.07% APY (no swap needed)
export const BLENDED_APY_PCT = 6.22  // estimated blended APY

// ── Guardrails ────────────────────────────────────────────────────────
export const MAX_LP_ALLOCATION_BPS        = 3000  // 30%
export const MAX_VOLATILE_ALLOC_BPS       = 4000  // 40%
export const IL_STOP_LOSS_BPS             = 500   // 5% IL triggers exit
export const MAX_REBALANCE_INTERVAL_MS    = 24 * 60 * 60 * 1000  // 24h
export const MAX_SLIPPAGE_BPS             = 100   // 1%
export const APY_CHANGE_THRESHOLD_PCT     = 2     // rebalance if APY shifts >2%
export const MAX_ALLOCATION_SHIFT_BPS     = 2000  // max 20% shift per rebalance
export const MAX_GAS_TO_YIELD_RATIO_PCT   = 10    // skip if gas > 10% of yield

// ── Fee model ─────────────────────────────────────────────────────────
export const PERFORMANCE_FEE_BPS          = 2000   // 20% of yield only
export const CHAT_FEE_USDC                = "0.01" // x402 per message
export const FREE_CHAT_LIMIT_PER_MONTH    = 10     // free messages/month

// ── Agent cycle ───────────────────────────────────────────────────────
export const AGENT_CYCLE_INTERVAL_MS      = 1 * 60 * 60 * 1000  // every 1h

// ── Goal milestones (%) — alert user when these thresholds are crossed ─
export const MILESTONE_THRESHOLDS_PCT     = [25, 50, 75, 100] as const

// ── Telegram link code TTL ────────────────────────────────────────────
export const TELEGRAM_LINK_CODE_TTL_MS    = 15 * 60 * 1000  // 15 minutes

// ── Gas — native CELO ─────────────────────────────────────────────────
// Agent wallet pays gas in native CELO (standard EVM behaviour).
// Ensure AGENT_SIGNER_PRIVATE_KEY wallet holds sufficient CELO for gas.
export const FEE_CURRENCY_SYMBOL          = "CELO"

// ── Whitelisted assets ────────────────────────────────────────────────
export const STABLE_ASSETS                = ["USDm", "USDT", "USDC"] as const
export const VOLATILE_ASSETS              = ["wETH"] as const
export const WHITELISTED_ASSETS           = [...STABLE_ASSETS, ...VOLATILE_ASSETS] as const
export type WhitelistedAsset              = typeof WHITELISTED_ASSETS[number]

// ── Risk profiles ─────────────────────────────────────────────────────
export type RiskProfile = "conservative" | "moderate" | "aggressive"

export const RISK_PROFILES: Record<RiskProfile, {
  aavePct:  number
  lpPct:    number
  wethPct:  number
  label:    string
}> = {
  conservative: { aavePct: 100, lpPct:  0, wethPct:  0, label: "Stable only (Aave)"        },
  moderate:     { aavePct:  70, lpPct: 20, wethPct: 10, label: "Balanced (Aave + LP)"      },
  aggressive:   { aavePct:  40, lpPct: 30, wethPct: 30, label: "Growth (Aave + LP + WETH)" },
}

// ── Retry ─────────────────────────────────────────────────────────────
export const MAX_TX_RETRIES      = 3
export const TX_RETRY_DELAYS_MS  = [5_000, 15_000, 30_000]

// ── Hardcoded strategy (fallback when OpenClaw is unavailable) ────────
export const HARDCODED_STRATEGY = {
  expectedApyMin:      5.5,    // blended APY floor
  expectedApyMax:      9.5,    // blended APY ceiling
  fxHedgeThresholdPct: 3.0,    // hedge when FX drifts >3%
  monitorCadenceHours: 6,      // every 6h agent cycle
  confidenceScore:     0.85,   // hardcoded → lower than OpenClaw
} as const
