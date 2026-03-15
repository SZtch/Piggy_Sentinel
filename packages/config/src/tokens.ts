// ─────────────────────────────────────────────────────────────────────────────
// @piggy/config — Token Addresses
//
// All token addresses for Celo mainnet and Alfajores testnet.
// Source:
//   mainnet — https://docs.celo.org/token-addresses
//   alfajores — https://alfajores.celoscan.io
// ─────────────────────────────────────────────────────────────────────────────

import type { Address } from "viem";

export type TokenSymbol = "USDm" | "USDC" | "USDT" | "wETH" | "CELO" | "cEUR" | "cREAL";

type TokenMap = Record<TokenSymbol, Address>;
type ChainTokens = Record<number, TokenMap>;

// ── Celo Mainnet (chainId 42220) ──────────────────────────────────────────────
const MAINNET_TOKENS: TokenMap = {
  // Mento stablecoins
  USDm: "0x765DE816845861e75A25fCA122bb6898B8B1282a",  // cUSD (Mento)
  cEUR: "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73",  // cEUR (Mento)
  cREAL:"0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787",  // cREAL (Mento)

  // Circle / Tether bridged
  USDC: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",  // USDC (native via Circle)
  USDT: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",  // USDT (native Celo, confirmed Celoscan)

  // Wrapped tokens
  wETH: "0x66803FB87aBd4aaC3cbB3fAd02C4d1BbBaE957F1",  // Wrapped Ether on Celo
  CELO: "0x471EcE3750Da237f93B8E339c536989b8978a438",  // Wrapped CELO (ERC-20)
};

// ── Alfajores Testnet (chainId 44787) ─────────────────────────────────────────
const ALFAJORES_TOKENS: TokenMap = {
  USDm: "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1",  // cUSD Alfajores
  cEUR: "0x10c892A6EC43a53E45D0B916B4b7D383B1b78C0F",
  cREAL:"0xE4D517785D091D3c54818832dB6094bcc2744545",
  USDC: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B",  // USDC Alfajores
  USDT: "0x0000000000000000000000000000000000000000",  // No USDT on Alfajores — use USDC
  wETH: "0x0000000000000000000000000000000000000000",  // No canonical wETH on Alfajores
  CELO: "0xF194afDf50B03e69Bd7D057c1Aa9e10c9954E4C",  // Wrapped CELO Alfajores
};

// ── Anvil fork (chainId 42220, same as mainnet) ────────────────────────────────
// Fork inherits all mainnet contracts, so we reuse mainnet addresses.

const TOKEN_REGISTRY: ChainTokens = {
  42220: MAINNET_TOKENS,  // mainnet
  44787: ALFAJORES_TOKENS, // alfajores
};

/**
 * Get the on-chain address for a token on the given chain.
 *
 * @throws if chainId or symbol is not registered
 */
export function getTokenAddress(chainId: number, symbol: TokenSymbol): Address {
  const chainTokens = TOKEN_REGISTRY[chainId];
  if (!chainTokens) {
    throw new Error(`@piggy/config/tokens: unknown chainId ${chainId}`);
  }
  const addr = chainTokens[symbol];
  if (!addr) {
    throw new Error(`@piggy/config/tokens: unknown symbol "${symbol}" on chain ${chainId}`);
  }
  if (addr === "0x0000000000000000000000000000000000000000") {
    throw new Error(`@piggy/config/tokens: "${symbol}" is not available on chain ${chainId}`);
  }
  return addr;
}

/**
 * Get all token addresses for a chain (useful for bulk approvals).
 */
export function getAllTokenAddresses(chainId: number): TokenMap {
  const chainTokens = TOKEN_REGISTRY[chainId];
  if (!chainTokens) {
    throw new Error(`@piggy/config/tokens: unknown chainId ${chainId}`);
  }
  return chainTokens;
}

/**
 * Return token decimals for common tokens.
 * USDC / USDT → 6 dec
 * everything else → 18 dec
 */
export function getTokenDecimals(symbol: TokenSymbol): number {
  return symbol === "USDC" || symbol === "USDT" ? 6 : 18;
}
