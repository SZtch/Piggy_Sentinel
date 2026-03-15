// ─────────────────────────────────────────────────────────────────────────────
// @piggy/agent — Skills (agent-level wrappers)
//
// These wrap the lower-level packages/skills functions and add
// agent-specific concerns (logging, error handling, gas checks).
// ─────────────────────────────────────────────────────────────────────────────

import { logger }                from "@piggy/shared";
import { SENTINEL_EXECUTOR_ABI } from "@piggy/shared";
import {
  MIN_REBALANCE_AMOUNT,
  MAX_REBALANCE_INTERVAL_MS,
  APY_CHANGE_THRESHOLD_PCT,
  MAX_ALLOCATION_SHIFT_BPS,
  ALLOC_USDT_BPS, ALLOC_USDC_BPS, ALLOC_USDM_BPS,
  BLENDED_APY_PCT,
} from "@piggy/shared";
import { getTokenAddress }       from "@piggy/config/tokens";
import { CHAIN_ID }              from "@piggy/config/chains";
import { encodeFunctionData, parseUnits, type Address } from "viem";

// IL threshold — exit LP if loss exceeds this %
const IL_THRESHOLD_PCT = 5.0;

// ─────────────────────────────────────────────────────────────────────────────
// checkIL
// ─────────────────────────────────────────────────────────────────────────────

export interface UniswapPositions {
  tokenIds:      number[];
  entryValues:   bigint[];
  currentValues: bigint[];
}

/**
 * Check all LP positions for impermanent loss exceeding threshold.
 * Returns tokenIds that should be exited.
 */
export function checkIL(positions: UniswapPositions): number[] {
  const exits: number[] = [];

  for (let i = 0; i < positions.tokenIds.length; i++) {
    const entry   = positions.entryValues[i]   ?? 0n;
    const current = positions.currentValues[i] ?? 0n;

    if (entry === 0n) continue;

    const ilPct = Number(entry - current) / Number(entry) * 100;

    if (ilPct >= IL_THRESHOLD_PCT) {
      logger.info("checkIL: IL threshold exceeded", {
        tokenId: positions.tokenIds[i],
        ilPct:   ilPct.toFixed(2),
        threshold: IL_THRESHOLD_PCT,
      });
      exits.push(positions.tokenIds[i]!);
    }
  }

  return exits;
}

// ─────────────────────────────────────────────────────────────────────────────
// rebalancePortfolio
// ─────────────────────────────────────────────────────────────────────────────

export interface TxCalldata {
  to:          Address;
  data:        `0x${string}`;
  value:       bigint;
  description?: string;
}

export interface RebalanceInput {
  userWallet:       string;
  executorAddress:  string;
  balances:         { usdm: bigint; usdc: bigint; usdt: bigint; weth: bigint };
  aavePositions:    { aUSDm: bigint; aUSDC: bigint; aUSDT: bigint };
  uniswapPositions: UniswapPositions;
  currentApys:      { usdt: number; usdc: number; usdm: number };
  lastRebalancedAt: Date | null;
  estimatedGasUSD:  number;
  wethPriceUSD:     number;
}

export interface RebalanceResult {
  shouldRebalance:  boolean;
  skipReason?:      string;
  actions:          TxCalldata[];
  estimatedNewApy:  number;
}

const BPS      = 10_000n;
const SLIPPAGE = 9_900n; // 99% — 1% max slippage

/**
 * Determine if a rebalance is needed and build the calldata.
 *
 * Uses the same guardrails as decisionEngine but focused on the
 * actual token movements needed.
 */
export async function rebalancePortfolio(input: RebalanceInput): Promise<RebalanceResult> {
  const {
    userWallet, executorAddress, balances, aavePositions,
    currentApys, lastRebalancedAt, estimatedGasUSD, wethPriceUSD,
  } = input;

  const user     = userWallet as Address;
  const executor = executorAddress as Address;

  // Token addresses
  const usdmAddr = getTokenAddress(CHAIN_ID, "USDm");
  const usdcAddr = getTokenAddress(CHAIN_ID, "USDC");
  const usdtAddr = getTokenAddress(CHAIN_ID, "USDT");

  // ── Total portfolio value ──────────────────────────────────────────────────
  const norm6  = (v: bigint) => Number(v) / 1e6;
  const norm18 = (v: bigint) => Number(v) / 1e18;

  const totalUSD =
    norm18(balances.usdm) +
    norm6(balances.usdc) +
    norm6(balances.usdt) +
    norm18(balances.weth) * wethPriceUSD +
    norm18(aavePositions.aUSDm) +
    norm6(aavePositions.aUSDC) +
    norm6(aavePositions.aUSDT);

  const minAmount = MIN_REBALANCE_AMOUNT;
  if (totalUSD < minAmount) {
    return skip(`portfolio $${totalUSD.toFixed(2)} < min $${minAmount}`);
  }

  // ── Frequency guardrail ────────────────────────────────────────────────────
  if (lastRebalancedAt) {
    const msSince = Date.now() - lastRebalancedAt.getTime();
    if (msSince < MAX_REBALANCE_INTERVAL_MS) {
      const h = Math.ceil((MAX_REBALANCE_INTERVAL_MS - msSince) / 3_600_000);
      return skip(`rebalanced recently — wait ${h}h`);
    }
  }

  // ── APY drift check ────────────────────────────────────────────────────────
  const newBlended =
    currentApys.usdt * (ALLOC_USDT_BPS / 10_000) +
    currentApys.usdc * (ALLOC_USDC_BPS / 10_000) +
    currentApys.usdm * (ALLOC_USDM_BPS / 10_000);

  const apyDrift = Math.abs(newBlended - BLENDED_APY_PCT);
  if (apyDrift < APY_CHANGE_THRESHOLD_PCT && lastRebalancedAt !== null) {
    return skip(`APY drift ${apyDrift.toFixed(2)}% < threshold`);
  }

  // ── Compute optimal new allocation ────────────────────────────────────────
  const total = currentApys.usdt + currentApys.usdc + currentApys.usdm;
  const rawUsdt = total > 0 ? Math.round((currentApys.usdt / total) * 10_000) : ALLOC_USDT_BPS;
  const rawUsdc = total > 0 ? Math.round((currentApys.usdc / total) * 10_000) : ALLOC_USDC_BPS;
  const rawUsdm = 10_000 - rawUsdt - rawUsdc;

  // Clamp shift to MAX_ALLOCATION_SHIFT_BPS
  const clamp = (current: number, target: number) => {
    const diff = target - current;
    return Math.abs(diff) > MAX_ALLOCATION_SHIFT_BPS
      ? current + Math.sign(diff) * MAX_ALLOCATION_SHIFT_BPS
      : target;
  };

  const newUsdt = clamp(ALLOC_USDT_BPS, rawUsdt);
  const newUsdc = clamp(ALLOC_USDC_BPS, rawUsdc);

  const totalBig   = BigInt(Math.round(totalUSD * 1e18));
  const newUsdtAmt = (totalBig * BigInt(newUsdt)) / BPS;
  const newUsdcAmt = (totalBig * BigInt(newUsdc)) / BPS;

  // USDC/USDT are 6-dec on-chain
  const newUsdtAmt6 = newUsdtAmt / 10n ** 12n;
  const newUsdcAmt6 = newUsdcAmt / 10n ** 12n;

  // ── Build calldata ─────────────────────────────────────────────────────────
  //
  // REBALANCE FIX: Flow yang benar adalah:
  //   1. Withdraw semua aToken dari Aave → parkedFunds di kontrak
  //   2. Swap aToken non-USDm kembali ke USDm (dari parkedFunds)
  //   3. executeMentoSwapAndSupply dengan alokasi baru (atomic: swap+supply)
  //   4. Supply sisa USDm langsung ke Aave
  //
  // Versi lama langsung swap dari wallet user yang sudah kosong (semua
  // dana sudah di Aave setelah initial allocation) → selalu revert.
  //
  // Dengan fix parkedFunds di executeMentoSwap, step 2 akan ambil dari
  // parkedFunds bukan dari wallet user.
  // ─────────────────────────────────────────────────────────────────────────

  const actions: TxCalldata[] = [];

  // ── Helper: withdraw dari Aave ────────────────────────────────────────────
  const withdraw = (asset: Address, amt: bigint, desc: string): TxCalldata => ({
    to:          executor,
    data:        encodeFunctionData({
      abi: SENTINEL_EXECUTOR_ABI, functionName: "executeAaveWithdraw",
      args: [user, asset, amt],
    }),
    value:       0n,
    description: desc,
  });

  // ── Helper: swap via Mento (pakai parkedFunds jika ada) ──────────────────
  const swap = (from: Address, to: Address, amtIn: bigint, minOut: bigint, desc: string): TxCalldata => ({
    to:          executor,
    data:        encodeFunctionData({
      abi: SENTINEL_EXECUTOR_ABI, functionName: "executeMentoSwap",
      args: [user, from, to, amtIn, minOut],
    }),
    value:       0n,
    description: desc,
  });

  // ── Helper: swap+supply atomic via Mento → Aave ──────────────────────────
  const swapAndSupply = (
    from: Address, to: Address,
    amtIn: bigint, minOut: bigint, minATokens: bigint,
    desc: string
  ): TxCalldata => ({
    to:          executor,
    data:        encodeFunctionData({
      abi: SENTINEL_EXECUTOR_ABI, functionName: "executeMentoSwapAndSupply",
      args: [user, from, to, amtIn, minOut, minATokens],
    }),
    value:       0n,
    description: desc,
  });

  // ── Helper: supply langsung ke Aave ──────────────────────────────────────
  const supply = (asset: Address, amt: bigint, desc: string): TxCalldata => ({
    to:          executor,
    data:        encodeFunctionData({
      abi: SENTINEL_EXECUTOR_ABI, functionName: "executeAaveSupply",
      args: [user, asset, amt, (amt * SLIPPAGE) / 10_000n],
    }),
    value:       0n,
    description: desc,
  });

  // ── Step 1: Withdraw semua aToken dari Aave → parkedFunds ─────────────────
  // Urutan: USDT dulu (terbesar), lalu USDC, lalu USDm
  if (aavePositions.aUSDT > 0n) {
    actions.push(withdraw(usdtAddr, aavePositions.aUSDT, `Withdraw aUSDT ${aavePositions.aUSDT.toString()}`));
  }
  if (aavePositions.aUSDC > 0n) {
    actions.push(withdraw(usdcAddr, aavePositions.aUSDC, `Withdraw aUSDC ${aavePositions.aUSDC.toString()}`));
  }
  if (aavePositions.aUSDm > 0n) {
    actions.push(withdraw(usdmAddr, aavePositions.aUSDm, `Withdraw aUSDm ${aavePositions.aUSDm.toString()}`));
  }

  // ── Step 2: Konversi semua ke USDm dulu via Mento (dari parkedFunds) ──────
  // USDT → USDm
  if (aavePositions.aUSDT > 0n) {
    const minOut = (aavePositions.aUSDT * 10n ** 12n * SLIPPAGE) / 10_000n; // scale 6→18 dec, lalu slippage
    actions.push(swap(usdtAddr, usdmAddr, aavePositions.aUSDT, minOut,
      `Swap USDT→USDm ${aavePositions.aUSDT.toString()} (6-dec)`));
  }
  // USDC → USDm
  if (aavePositions.aUSDC > 0n) {
    const minOut = (aavePositions.aUSDC * 10n ** 12n * SLIPPAGE) / 10_000n;
    actions.push(swap(usdcAddr, usdmAddr, aavePositions.aUSDC, minOut,
      `Swap USDC→USDm ${aavePositions.aUSDC.toString()} (6-dec)`));
  }

  // ── Step 3: Re-supply dengan alokasi baru via executeMentoSwapAndSupply ───
  // USDm → USDT (atomic swap+supply)
  if (newUsdtAmt6 > 0n) {
    const minOut      = (newUsdtAmt6 * SLIPPAGE) / 10_000n;
    const minATokens  = (newUsdtAmt6 * SLIPPAGE) / 10_000n;
    actions.push(swapAndSupply(
      usdmAddr, usdtAddr, newUsdtAmt, minOut, minATokens,
      `SwapAndSupply USDm→USDT ${newUsdtAmt6.toString()} (6-dec)`
    ));
  }
  // USDm → USDC (atomic swap+supply)
  if (newUsdcAmt6 > 0n) {
    const minOut      = (newUsdcAmt6 * SLIPPAGE) / 10_000n;
    const minATokens  = (newUsdcAmt6 * SLIPPAGE) / 10_000n;
    actions.push(swapAndSupply(
      usdmAddr, usdcAddr, newUsdcAmt, minOut, minATokens,
      `SwapAndSupply USDm→USDC ${newUsdcAmt6.toString()} (6-dec)`
    ));
  }

  // ── Step 4: Supply sisa USDm langsung ke Aave ─────────────────────────────
  const usdmRemainder = totalBig - newUsdtAmt - newUsdcAmt;
  if (usdmRemainder > 0n) {
    actions.push(supply(usdmAddr, usdmRemainder, `Supply USDm ${usdmRemainder.toString()}`));
  }

  logger.info("rebalancePortfolio: actions built", {
    wallet:      userWallet,
    totalUSD:    totalUSD.toFixed(2),
    newBlended:  newBlended.toFixed(2),
    actions:     actions.length,
  });

  return {
    shouldRebalance: true,
    actions,
    estimatedNewApy: newBlended,
  };
}

function skip(reason: string): RebalanceResult {
  return { shouldRebalance: false, skipReason: reason, actions: [], estimatedNewApy: BLENDED_APY_PCT };
}