import type { SupportedChainId } from "./chains.js";

interface ProtocolAddresses {
  aaveV3Pool:  `0x${string}` | null;
  mentoBroker: `0x${string}` | null;
}

// ── Protocol registry ─────────────────────────────────────────────────────
// Mainnet: verify before prod deploy.
// Sepolia: set via env after Day 1 verification.
const PROTOCOLS: Record<SupportedChainId, ProtocolAddresses> = {
  42220: {
    aaveV3Pool:  "0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402",
    mentoBroker: "0x777A8255cA72412f0d706dc03C9D1987306B4CaD",
  },
  11142220: {
    aaveV3Pool:  (process.env.AAVE_POOL_ADDRESS_SEPOLIA  as `0x${string}`) || null,
    mentoBroker: (process.env.MENTO_BROKER_ADDRESS_SEPOLIA as `0x${string}`) || null,
  },
};

export type ProtocolKey = keyof ProtocolAddresses;

/** Returns address or throws with actionable message. */
export function getProtocolAddress(chainId: SupportedChainId, protocol: ProtocolKey): `0x${string}` {
  const addr = PROTOCOLS[chainId]?.[protocol];
  if (!addr) {
    const envKey =
      protocol === "aaveV3Pool"  ? "AAVE_POOL_ADDRESS_SEPOLIA" :
      protocol === "mentoBroker" ? "MENTO_BROKER_ADDRESS_SEPOLIA" : protocol;
    throw new Error(
      `[protocols] ${protocol} is not configured for chain ${chainId}.\n` +
      `  Set ${envKey} in .env after verifying the address on the testnet explorer.`
    );
  }
  return addr;
}
