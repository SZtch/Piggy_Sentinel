import type { SkillResult } from "@piggy/shared";
import { SENTINEL_EXECUTOR_ABI } from "@piggy/shared";
import { logger } from "@piggy/shared";
import {
  ALLOC_USDT_BPS, ALLOC_USDC_BPS, ALLOC_USDM_BPS,
  MIN_AAVE_SUPPLY_AMOUNT,
} from "@piggy/shared";
import { getTokenAddress } from "@piggy/config/tokens";
import { CHAIN_ID } from "@piggy/config/chains";
import { encodeFunctionData, parseUnits, type Address } from "viem";

export interface TxCalldata {
  to:           Address;
  data:         `0x${string}`;
  /** Native CELO value — always 0n for ERC-20 operations */
  value:        bigint;
  /** Human-readable description for logging */
  description?: string;
}

export interface AllocateSavingsInput {
  userWallet:      string;
  totalAmount:     bigint;   // total USDm to allocate
  executorAddress: string;
}

export interface AllocateSavingsOutput {
  swaps:    TxCalldata[];   // USDm → USDT, USDm → USDC via Mento
  supplies: TxCalldata[];   // supply USDT, USDC, USDm to Aave
  breakdown: {
    usdt: bigint;
    usdc: bigint;
    usdm: bigint;
  };
}

const BPS = 10_000n;

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
export async function allocateSavings(
  input: AllocateSavingsInput
): Promise<SkillResult<AllocateSavingsOutput>> {
  try {
    const { userWallet, totalAmount, executorAddress } = input;

    if (totalAmount <= 0n) {
      return { success: false, data: null, error: "amount must be > 0", txHash: null, agentscanEventId: null, executedAt: new Date() };
    }

    const minAmount = parseUnits(MIN_AAVE_SUPPLY_AMOUNT.toString(), 18);
    if (totalAmount < minAmount) {
      return { success: false, data: null, error: `amount below minimum ${MIN_AAVE_SUPPLY_AMOUNT}`, txHash: null, agentscanEventId: null, executedAt: new Date() };
    }

    // ── Calculate allocation ───────────────────────────────────────
    // All amounts below are in USDm units (18 dec).
    // After Mento swaps, USDT and USDC are received in 6 dec — de-normalise before
    // passing to contract calls so transferFrom and Aave supply don't attempt to
    // move 10^12× the intended amount.
    const usdtAmount18 = (totalAmount * BigInt(ALLOC_USDT_BPS)) / BPS;  // 60% in 18-dec
    const usdcAmount18 = (totalAmount * BigInt(ALLOC_USDC_BPS)) / BPS;  // 30% in 18-dec
    const usdmAmount   = totalAmount - usdtAmount18 - usdcAmount18;       // 10% remainder (USDm, 18-dec)

    // De-normalise to 6-dec for USDT/USDC contract calls
    const usdtAmount6 = usdtAmount18 / 10n ** 12n;
    const usdcAmount6 = usdcAmount18 / 10n ** 12n;

    const usdmAddr = getTokenAddress(CHAIN_ID, "USDm");
    const usdtAddr = getTokenAddress(CHAIN_ID, "USDT");
    const usdcAddr = getTokenAddress(CHAIN_ID, "USDC");
    const executor = executorAddress as Address;
    const user     = userWallet as Address;

    const SLIPPAGE99_BPS = 9_900n; // 99% = 1% max slippage

    // ── Build calldata: atomic swap+supply via executeMentoSwapAndSupply ──
    //
    // Satu call per asset: swap USDm → USDT/USDC dan langsung supply ke Aave
    // dalam 1 transaksi. Output Mento tidak balik ke userWallet.
    // User hanya perlu approve USDm — tidak perlu approve USDC/USDT.
    //
    // minAmountOut = expected USDT/USDC output dalam 6-dec (native token decimals)
    // minATokens   = 99% dari minAmountOut (slippage Aave supply sangat kecil)
    const swaps: TxCalldata[] = []; // tidak dipakai lagi — swap+supply sudah atomic

    const supplies: TxCalldata[] = [
      // 60%: USDm → USDT → Aave (atomic)
      {
        to:          executor,
        data:        encodeFunctionData({
          abi:          SENTINEL_EXECUTOR_ABI,
          functionName: "executeMentoSwapAndSupply",
          args: [
            user, usdmAddr, usdtAddr,
            usdtAmount18,                                   // amountIn: USDm (18-dec)
            (usdtAmount6 * SLIPPAGE99_BPS) / 10_000n,       // minAmountOut: USDT (6-dec)
            (usdtAmount6 * SLIPPAGE99_BPS) / 10_000n,       // minATokens: aUSDT (6-dec)
          ],
        }),
        value:       0n,
        description: `MentoSwapAndSupply ${usdtAmount18.toString()} USDm → USDT → Aave`,
      },
      // 30%: USDm → USDC → Aave (atomic)
      {
        to:          executor,
        data:        encodeFunctionData({
          abi:          SENTINEL_EXECUTOR_ABI,
          functionName: "executeMentoSwapAndSupply",
          args: [
            user, usdmAddr, usdcAddr,
            usdcAmount18,
            (usdcAmount6 * SLIPPAGE99_BPS) / 10_000n,
            (usdcAmount6 * SLIPPAGE99_BPS) / 10_000n,
          ],
        }),
        value:       0n,
        description: `MentoSwapAndSupply ${usdcAmount18.toString()} USDm → USDC → Aave`,
      },
      // 10%: USDm langsung ke Aave (tidak perlu swap)
      {
        to:          executor,
        data:        encodeFunctionData({
          abi:          SENTINEL_EXECUTOR_ABI,
          functionName: "executeAaveSupply",
          args: [user, usdmAddr, usdmAmount, (usdmAmount * SLIPPAGE99_BPS) / 10_000n],
        }),
        value:       0n,
        description: `Aave supply ${usdmAmount.toString()} USDm (18-dec)`,
      },
    ];

    logger.info("allocateSavings: multi-stablecoin calldata built", {
      wallet: userWallet,
      total:  totalAmount.toString(),
      usdt18: usdtAmount18.toString(),
      usdt6:  usdtAmount6.toString(),
      usdc18: usdcAmount18.toString(),
      usdc6:  usdcAmount6.toString(),
      usdm:   usdmAmount.toString(),
    });

    return {
      success: true,
      data:    { swaps, supplies, breakdown: { usdt: usdtAmount6, usdc: usdcAmount6, usdm: usdmAmount } },
      error:   null,
      txHash:  null,
      agentscanEventId: null,
      executedAt: new Date(),
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, data: null, error, txHash: null, agentscanEventId: null, executedAt: new Date() };
  }
}
