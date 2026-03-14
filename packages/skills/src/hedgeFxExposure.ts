import type { SkillResult } from "@piggy/shared";
import { SENTINEL_EXECUTOR_ABI } from "@piggy/shared";
import { logger } from "@piggy/shared";
import { mento } from "@piggy/adapters";
import { encodeFunctionData, type Address } from "viem";
import type { TokenSymbol } from "@piggy/config/tokens";
import type { HedgeFxExposureInput } from "./types.js";
import type { TxCalldata } from "./allocateSavings.js";

export async function buildHedgeCalldata(input: HedgeFxExposureInput): Promise<{ calldata: TxCalldata; minAmountOut: bigint }> {
  const minAmountOut = await mento.computeMinAmountOut(
    input.fromAsset as TokenSymbol,
    input.toAsset   as TokenSymbol,
    input.swapAmount,
    input.maxSlippagePct
  );

  const fromAddr = mento.tokenAddress(input.fromAsset as TokenSymbol);
  const toAddr   = mento.tokenAddress(input.toAsset   as TokenSymbol);

  const calldata: TxCalldata = {
    to: input.executorAddress as Address,
    data: encodeFunctionData({
      abi: SENTINEL_EXECUTOR_ABI,
      functionName: "executeMentoSwap",
      args: [input.agentWalletAddress as Address, fromAddr, toAddr, input.swapAmount, minAmountOut],
    }),
    value: 0n,   // ERC-20 swap — no native CELO sent
  };

  return { calldata, minAmountOut };
}

export async function hedgeFxExposure(
  input: HedgeFxExposureInput
): Promise<SkillResult<{ calldata: TxCalldata; minAmountOut: bigint }>> {
  try {
    if (input.swapAmount <= 0n) {
      return { success: false, data: null, error: "swapAmount must be > 0", txHash: null, agentscanEventId: null, executedAt: new Date() };
    }
    const result = await buildHedgeCalldata(input);
    logger.info("hedgeFxExposure: calldata built", { from: input.fromAsset, to: input.toAsset, amount: input.swapAmount.toString() });
    return { success: true, data: result, error: null, txHash: null, agentscanEventId: null, executedAt: new Date() };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error("hedgeFxExposure failed", error);
    return { success: false, data: null, error, txHash: null, agentscanEventId: null, executedAt: new Date() };
  }
}
