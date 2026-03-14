// ─────────────────────────────────────────────────────────────────────────────
// @piggy/config — Chain Configuration
//
// Single source of truth untuk chain ID, viem chain object, dan RPC URL.
// IS_MAINNET digunakan sebagai guard di seluruh codebase.
// ─────────────────────────────────────────────────────────────────────────────

import { defineChain } from "viem";

// ── Celo Mainnet ──────────────────────────────────────────────────────────────
export const celoMainnet = defineChain({
  id:          42220,
  name:        "Celo",
  nativeCurrency: {
    decimals: 18,
    name:     "CELO",
    symbol:   "CELO",
  },
  rpcUrls: {
    default: {
      http: [process.env.CELO_RPC_URL_MAINNET ?? "https://forno.celo.org"],
    },
  },
  blockExplorers: {
    default: { name: "CeloScan", url: "https://celoscan.io" },
  },
});

// ── Celo Alfajores (Sepolia equivalent) ───────────────────────────────────────
export const celoAlfajores = defineChain({
  id:          44787,
  name:        "Celo Alfajores",
  nativeCurrency: {
    decimals: 18,
    name:     "CELO",
    symbol:   "CELO",
  },
  rpcUrls: {
    default: {
      http: [process.env.CELO_RPC_URL_SEPOLIA ?? "https://alfajores-forno.celo-testnet.org"],
    },
  },
  blockExplorers: {
    default: { name: "CeloScan", url: "https://alfajores.celoscan.io" },
  },
  testnet: true,
});

// ── Active chain resolution ────────────────────────────────────────────────────
// APP_ENV=prod → mainnet
// APP_ENV=fork → mainnet (fork via Anvil, same chain ID 42220)
// everything else → Alfajores

const appEnv = process.env.APP_ENV ?? "dev";

export const IS_MAINNET = appEnv === "prod" || appEnv === "fork";

export const activeChain = IS_MAINNET ? celoMainnet : celoAlfajores;

export const CHAIN_ID: number = activeChain.id;

export const RPC_URL: string = activeChain.rpcUrls.default.http[0];
