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
export const TOKENS = {
    // ── Celo Sepolia (active testnet, chain ID 11142220) ──────────────
    // NOTE: was incorrectly keyed as 44787 (Alfajores legacy) — fixed.
    // Matches chains.ts: celoSepolia.id = 11142220
    11142220: {
        USDm: "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1",
        USDT: "0x1E0433C1769271b7A498c7c4E5dC94f0280FCd37",
        USDC: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B",
        wETH: "0x66803FB87aBd4aaC3cbB3fAd02C1c2D54B29efeb",
    },
    // ── Celo Mainnet ──────────────────────────────────────────────────
    42220: {
        USDm: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
        USDT: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
        USDC: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
        wETH: "0x66803FB87aBd4aaC3cbB3fAd02C1c2D54B29efeb",
    },
};
export function getTokenAddress(chainId, symbol) {
    const t = TOKENS[chainId];
    if (!t)
        throw new Error(`Unsupported chainId: ${chainId}`);
    const addr = t[symbol];
    if (!addr)
        throw new Error(`Token ${symbol} not available on chain ${chainId}`);
    return addr;
}
/** Stable assets — input + Aave yield */
export const STABLE_ASSETS = ["USDm", "USDT", "USDC"];
/** Volatile assets — Uniswap LP only */
export const VOLATILE_ASSETS = ["wETH"];
/** Assets that can be used in Uniswap LP */
export const LP_ASSETS = ["wETH", "USDC", "USDT"];
/** Supported LP pairs */
export const LP_PAIRS = [
    ["wETH", "USDC"],
    ["USDC", "USDT"],
];
/** Aave allocation — basis points */
export const AAVE_ALLOCATION = {
    USDm: 1000, // 10%
    USDT: 6000, // 60% — highest APY (8.89%)
    USDC: 3000, // 30%
    wETH: 0,
};
