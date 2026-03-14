// ─────────────────────────────────────────────────────────────────────────────
// @piggy/shared — Utilities
// ─────────────────────────────────────────────────────────────────────────────

import { APPROVAL_MULTIPLIER } from "./constants.js";

/**
 * Generate a random 6-character alphanumeric code for Telegram linking.
 * E.g. "X7K2P9"
 */
export function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Compute ERC-20 approval amount for agent spend limit.
 * Agent is approved for APPROVAL_MULTIPLIER × targetAmount to cover
 * rebalancing swaps without needing a new approval mid-cycle.
 *
 * @param targetAmount - goal target in token's native decimals (bigint)
 * @returns approval amount as bigint
 */
export function calcApprovalAmount(targetAmount: bigint): bigint {
  return targetAmount * APPROVAL_MULTIPLIER;
}

/**
 * Format a bigint token amount for logging.
 * @param amount - raw token amount
 * @param decimals - token decimals (6 for USDC/USDT, 18 for USDm)
 * @param symbol - token symbol for display
 */
export function formatTokenAmount(
  amount:   bigint,
  decimals: number,
  symbol:   string,
): string {
  const divisor = BigInt(10 ** decimals);
  const whole   = amount / divisor;
  const frac    = amount % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 2);
  return `${whole}.${fracStr} ${symbol}`;
}

/**
 * Sleep for a given number of milliseconds.
 * Useful in retry loops or polling.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry an async operation up to `attempts` times with exponential backoff.
 */
export async function withRetry<T>(
  fn:       () => Promise<T>,
  attempts: number = 3,
  baseMs:   number = 500,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await sleep(baseMs * 2 ** i);
      }
    }
  }
  throw lastErr;
}

/**
 * Truncate an Ethereum address for display: "0x1234...abcd"
 */
export function shortAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
