import { defineChain } from "viem";
export const celoSepolia = defineChain({
    id: 11142220,
    name: "Celo Sepolia",
    nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
    rpcUrls: {
        default: {
            http: [process.env.CELO_RPC_URL_SEPOLIA ?? "https://forno.celo-sepolia.celo.org"],
        },
    },
    blockExplorers: {
        default: { name: "Blockscout", url: "https://celo-sepolia.blockscout.com" },
    },
    testnet: true,
});
export const celoMainnet = defineChain({
    id: 42220,
    name: "Celo",
    nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
    rpcUrls: {
        default: {
            http: [process.env.CELO_RPC_URL_MAINNET ?? "https://forno.celo.org"],
        },
    },
    blockExplorers: {
        default: { name: "Blockscout", url: "https://celo.blockscout.com" },
    },
    testnet: false,
});
const APP_ENV = (process.env.APP_ENV ?? "dev");
const CHAIN_MAP = {
    dev: celoSepolia,
    staging: celoSepolia,
    prod: celoMainnet,
};
export const activeChain = CHAIN_MAP[APP_ENV];
export const CHAIN_ID = activeChain.id;
export const IS_MAINNET = CHAIN_ID === 42220;
export const IS_TESTNET = !IS_MAINNET;
export function getChain(id) {
    if (id === 11142220)
        return celoSepolia;
    if (id === 42220)
        return celoMainnet;
    throw new Error(`Unsupported chain ID: ${id}`);
}
