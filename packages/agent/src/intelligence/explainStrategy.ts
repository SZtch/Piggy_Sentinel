/**
 * Piggy Sentinel — Strategy Explanation Engine
 *
 * Translates the agent's mechanical decision output into
 * plain-English financial reasoning that Penny can deliver to the user.
 *
 * Covers:
 *   - Why a rebalance was triggered
 *   - Why a rebalance was skipped
 *   - Why an IL exit happened
 *   - What the current allocation means
 *   - Why a specific risk profile was chosen
 */

import type { AgentDecision, DecisionAction } from "@piggy/shared";
type PortfolioTier = "nano" | "small" | "mid" | "large";

export interface RebalanceContext {
  decision:          AgentDecision;
  previousApys?:     { usdm: number; usdc: number; usdt: number };
  currentApys:       { usdm: number; usdc: number; usdt: number };
  previousAllocBps?: { stableBps: number; lpBps: number; wethBps: number };
  driftPercent?:     number;
  ilExited?:         number;   // count of LP positions exited for IL
}

export interface ExplanationResult {
  /** One-sentence headline */
  headline:    string;
  /** Full explanation (2–4 sentences) */
  detail:      string;
  /** Combined message ready for Penny to send */
  message:     string;
}

function apyStr(apys: { usdm: number; usdc: number; usdt: number }): string {
  const blended = apys.usdt * 0.6 + apys.usdc * 0.3 + apys.usdm * 0.1;
  return `${blended.toFixed(1)}%`;
}

function tierLabel(tier: PortfolioTier): string {
  return { nano: "under $50", small: "$50–$200", mid: "$200–$1,000", large: "over $1,000" }[tier];
}

function allocLabel(alloc: { stableBps: number; lpBps: number; wethBps: number }): string {
  const parts: string[] = [];
  if (alloc.stableBps > 0) parts.push(`${alloc.stableBps / 100}% in Aave stable yield`);
  if (alloc.lpBps > 0)     parts.push(`${alloc.lpBps / 100}% in Uniswap liquidity`);
  if (alloc.wethBps > 0)   parts.push(`${alloc.wethBps / 100}% in WETH`);
  return parts.join(", ");
}

/**
 * Generate an explanation for the agent's rebalance decision.
 */
export function explainRebalance(ctx: RebalanceContext): ExplanationResult {
  const { decision, previousApys, currentApys, driftPercent, ilExited } = ctx;
  const { action, tier, targetAlloc, reason, estimatedNewApy } = decision;

  // ── Executed ──────────────────────────────────────────────────────────────
  if (action === "execute_rebalance") {
    const apyChange = previousApys
      ? (parseFloat(apyStr(currentApys)) - parseFloat(apyStr(previousApys))).toFixed(1)
      : null;

    const headline = "I rebalanced your portfolio.";

    let detail = `Your allocation has drifted ${driftPercent?.toFixed(1) ?? ""}% from target. `;

    if (apyChange && parseFloat(apyChange) > 0) {
      detail += `Aave yields improved (blended now ${apyStr(currentApys)}), so I shifted more into stable yield. `;
    } else if (apyChange && parseFloat(apyChange) < 0) {
      detail += `Yields shifted — I rebalanced to keep your allocation optimal at the current rates. `;
    } else {
      detail += `I realigned your portfolio to the target: ${allocLabel(targetAlloc)}. `;
    }

    detail += `Estimated APY going forward: ~${estimatedNewApy.toFixed(1)}%.`;

    return { headline, detail, message: `🔄 ${headline}\n\n${detail}` };
  }

  // ── Initial allocation ─────────────────────────────────────────────────────
  if (action === "execute_initial_alloc") {
    const headline = "I activated your savings strategy.";
    const detail   = `Your portfolio (${tierLabel(tier)} tier) is now allocated as: ${allocLabel(targetAlloc)}. ` +
      `Estimated blended APY: ~${estimatedNewApy.toFixed(1)}%. ` +
      `I'll check every 6 hours and rebalance when it improves your returns.`;
    return { headline, detail, message: `✅ ${headline}\n\n${detail}` };
  }

  // ── Skipped ────────────────────────────────────────────────────────────────
  if (action === "skip_guardrail" || action === "skip_unprofitable") {
    const headline = "No rebalance needed right now.";
    let detail: string;

    if (reason.includes("drift")) {
      detail = `Your allocation is within 10% of target — rebalancing now would cost more in gas than it gains in yield. ` +
        `I'll check again in 6 hours.`;
    } else if (reason.includes("rebalanced recently")) {
      detail = `I rebalanced less than 24 hours ago. I'll check again in your next cycle. ` +
        `Current APY: ~${estimatedNewApy.toFixed(1)}%.`;
    } else if (action === "skip_unprofitable") {
      detail = `Gas cost right now exceeds the expected yield gain from rebalancing, ` +
        `so I'm holding steady. I'll retry when conditions improve.`;
    } else {
      detail = `${reason}. No action needed. `;
    }

    return { headline, detail, message: `ℹ️ ${headline} ${detail}` };
  }

  // ── Nano / Small tier skip ─────────────────────────────────────────────────
  if (action === "skip_nano" || action === "skip_small") {
    const headline = "Your portfolio is in Aave stable yield.";
    const detail   = `With a portfolio ${tierLabel(tier)}, I keep everything in safe stable-coin yield. ` +
      `As your balance grows, I'll unlock more advanced strategies automatically.`;
    return { headline, detail, message: `💰 ${headline}\n\n${detail}` };
  }

  // ── Paused ─────────────────────────────────────────────────────────────────
  if (action === "skip_paused") {
    const headline = "Automation is paused.";
    const detail   = "Your funds are still in Aave earning yield — I've just stopped rebalancing. Resume anytime.";
    return { headline, detail, message: `⏸️ ${headline} ${detail}` };
  }

  // Fallback
  const headline = "No action taken.";
  return { headline, detail: reason, message: `${headline} ${reason}` };
}

/**
 * Explain an IL (impermanent loss) exit.
 */
export function explainILExit(positionCount: number, ilPercent: number): ExplanationResult {
  const headline = `I exited ${positionCount === 1 ? "a liquidity position" : `${positionCount} liquidity positions`}.`;
  const detail   = `Impermanent loss reached ${ilPercent.toFixed(1)}%, crossing the 5% guardrail. ` +
    `I moved those funds back to Aave stable yield to protect your principal. ` +
    `No action needed from you.`;
  return { headline, detail, message: `⚠️ ${headline}\n\n${detail}` };
}

/**
 * Explain current portfolio allocation in plain English.
 */
export function explainAllocation(
  alloc: { stableBps: number; lpBps: number; wethBps: number },
  estimatedApy: number,
  tier: PortfolioTier,
): string {
  const lines: string[] = [
    `Here's how your savings are currently working:`,
    `• ${alloc.stableBps / 100}% is earning stable yield in Aave (USDC, USDT, USDm)`,
  ];
  if (alloc.lpBps > 0)
    lines.push(`• ${alloc.lpBps / 100}% is providing liquidity on Uniswap (earns trading fees)`);
  if (alloc.wethBps > 0)
    lines.push(`• ${alloc.wethBps / 100}% is held in WETH for growth exposure`);
  lines.push(`Overall estimated APY: ~${estimatedApy.toFixed(1)}%`);
  if (tier === "nano" || tier === "small")
    lines.push(`(Advanced strategies unlock at $200+)`);
  return lines.join("\n");
}
