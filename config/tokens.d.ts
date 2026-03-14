/**
 * Whitelisted assets for Piggy Sentinel.
 *
 * Stable assets (Aave yield + Mento routing):
 *   USDm  → input asset + gas fee (feeCurrency) + 10% Aave allocation
 *   USDT  → 60% Aave allocation (highest APY)
 *   USDC  → 30% Aave allocation
 *
 * Volatile assets (Uniswap LP):
 *   wETH  → Uniswap LP pairs (USDC/WETH, USDT/WETH)
 *
 * Swap routing:
 *   Mento:   USDm ↔ USDC, USDm ↔ USDT
 *   Uniswap: USDC ↔ WETH, USDT ↔ WETH (never Mento for WETH)
 */
export type TokenSymbol = "USDm" | "USDT" | "USDC" | "wETH";
export declare const TOKENS: Record<number, Record<TokenSymbol, `0x${string}`>>;
export type SupportedChainId = keyof typeof TOKENS;
export declare function getTokenAddress(chainId: number, symbol: TokenSymbol): `0x${string}`;
/** Stable assets — input + Aave yield */
export declare const STABLE_ASSETS: TokenSymbol[];
/** Volatile assets — Uniswap LP only */
export declare const VOLATILE_ASSETS: TokenSymbol[];
/** Assets that can be used in Uniswap LP */
export declare const LP_ASSETS: TokenSymbol[];
/** Supported LP pairs */
export declare const LP_PAIRS: [TokenSymbol, TokenSymbol][];
/** Aave allocation — basis points */
export declare const AAVE_ALLOCATION: Record<TokenSymbol, number>;
//# sourceMappingURL=tokens.d.ts.map