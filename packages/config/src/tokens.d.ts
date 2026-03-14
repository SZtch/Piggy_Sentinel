import type { Address } from "viem";
export type TokenSymbol = "USDm" | "USDC" | "USDT" | "wETH" | "CELO" | "cEUR" | "cREAL";
type TokenMap = Record<TokenSymbol, Address>;
/**
 * Get the on-chain address for a token on the given chain.
 *
 * @throws if chainId or symbol is not registered
 */
export declare function getTokenAddress(chainId: number, symbol: TokenSymbol): Address;
/**
 * Get all token addresses for a chain (useful for bulk approvals).
 */
export declare function getAllTokenAddresses(chainId: number): TokenMap;
/**
 * Return token decimals for common tokens.
 * USDC / USDT → 6 dec
 * everything else → 18 dec
 */
export declare function getTokenDecimals(symbol: TokenSymbol): number;
export {};
//# sourceMappingURL=tokens.d.ts.map