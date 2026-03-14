// ─────────────────────────────────────────────────────────────────────────────
// @piggy/adapters — Aave V3 Adapter
//
// Reads live APY (liquidity rate) for stablecoin reserves on Celo mainnet.
// Used by the scheduler to drive dynamic rebalancing decisions.
// ─────────────────────────────────────────────────────────────────────────────

import { createPublicClient, http } from "viem";
import { activeChain, CHAIN_ID }    from "@piggy/config/chains";
import { getTokenAddress }          from "@piggy/config/tokens";
import type { TokenSymbol }         from "@piggy/config/tokens";

// Aave V3 Pool Data Provider on Celo mainnet
// Source: https://docs.aave.com/developers/deployed-contracts/v3-mainnet/celo
const AAVE_DATA_PROVIDER = "0x3E59A31363BF5a55D8b31E5b7E59b7B3B14e32B7" as const;

// getReserveData returns a tuple; we only need liquidityRate (index 5 = RAY)
const DATA_PROVIDER_ABI = [
  {
    type:            "function",
    name:            "getReserveData",
    stateMutability: "view",
    inputs:  [{ name: "asset", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "unbacked",                     type: "uint256" },
          { name: "accruedToTreasuryScaled",       type: "uint128" },
          { name: "totalAToken",                   type: "uint128" },
          { name: "totalStableDebt",               type: "uint128" },
          { name: "totalVariableDebt",             type: "uint128" },
          { name: "liquidityRate",                 type: "uint128" }, // RAY = 1e27
          { name: "variableBorrowRate",            type: "uint128" },
          { name: "stableBorrowRate",              type: "uint128" },
          { name: "averageStableBorrowRate",       type: "uint128" },
          { name: "liquidityIndex",                type: "uint128" },
          { name: "variableBorrowIndex",           type: "uint128" },
          { name: "lastUpdateTimestamp",           type: "uint40"  },
        ],
      },
    ],
  },
] as const;

const RAY = BigInt("1000000000000000000000000000"); // 1e27

const publicClient = createPublicClient({
  chain:     activeChain,
  transport: http(),
});

/**
 * Get live APY (%) for an asset from Aave V3 on-chain data.
 *
 * liquidityRate is in RAY (1e27). APY ≈ liquidityRate / RAY * 100.
 * This is a simplification — exact APY accounts for compounding,
 * but the difference is negligible for short rebalance intervals.
 *
 * @param symbol - Token symbol: "USDm", "USDC", or "USDT"
 * @returns APY as a percentage number (e.g. 8.89 for 8.89%)
 */
export async function getCurrentApy(symbol: TokenSymbol): Promise<number> {
  const asset = getTokenAddress(CHAIN_ID, symbol);

  const data = await publicClient.readContract({
    address:      AAVE_DATA_PROVIDER,
    abi:          DATA_PROVIDER_ABI,
    functionName: "getReserveData",
    args:         [asset],
  });

  const liquidityRate = data.liquidityRate;

  if (!liquidityRate || liquidityRate === 0n) {
    throw new Error(`Aave: liquidityRate=0 for ${symbol} — asset may not be listed`);
  }

  // Convert RAY to APY %
  // liquidityRate / RAY = annual rate (decimal)
  const apyDecimal = Number(liquidityRate) / Number(RAY);
  const apyPct     = apyDecimal * 100;

  return apyPct;
}
