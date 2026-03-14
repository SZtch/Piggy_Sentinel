import { parseUnits, formatUnits } from "viem";

export const toWei   = (n: string | number): bigint => parseUnits(String(n), 18);
export const fromWei = (n: bigint, dp = 4): string  => parseFloat(formatUnits(n, 18)).toFixed(dp);

export const calcApprovalAmount = (goal: bigint, bufferPct = 5): bigint =>
  goal + (goal * BigInt(bufferPct)) / 100n;

export const calcMinAmountOut = (expected: bigint, slippagePct = 0.5): bigint =>
  (expected * BigInt(Math.round((1 - slippagePct / 100) * 10_000))) / 10_000n;

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export const generateCode = (len = 6): string => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
};

export const logger = {
  info:  (msg: string, meta?: unknown) => console.log(`[INFO]  ${msg}`, meta ?? ""),
  warn:  (msg: string, meta?: unknown) => console.warn(`[WARN]  ${msg}`, meta ?? ""),
  error: (msg: string, meta?: unknown) => console.error(`[ERROR] ${msg}`, meta ?? ""),
  debug: (msg: string, meta?: unknown) => { if (process.env.DEBUG) console.debug(`[DEBUG] ${msg}`, meta ?? ""); },
};
