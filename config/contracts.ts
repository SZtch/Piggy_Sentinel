/**
 * Contract addresses for Piggy Sentinel.
 *
 * Architecture (post-refactor):
 *   - NO per-user AgentWallet contracts
 *   - ONE SentinelExecutor singleton manages all user strategies
 *   - ONE agentSigner EOA triggers all automation
 *   - Users approve SentinelExecutor directly
 */

export const CONTRACTS = {
  // ── Celo Sepolia (testnet, chain ID 11142220) ──────────────────────
  // NOTE: was incorrectly keyed as 44787 (Alfajores legacy) — fixed.
  11142220: {
    sentinelExecutor: "" as `0x${string}`,   // deploy via Deploy.s.sol
    aaveAdapter:      "" as `0x${string}`,
    mentoAdapter:     "" as `0x${string}`,
    uniswapAdapter:   "" as `0x${string}`,
    treasury:         "" as `0x${string}`,   // team treasury wallet
  },

  // ── Celo Mainnet ───────────────────────────────────────────────────
  42220: {
    sentinelExecutor: "" as `0x${string}`,
    aaveAdapter:      "" as `0x${string}`,
    mentoAdapter:     "" as `0x${string}`,
    uniswapAdapter:   "" as `0x${string}`,
    treasury:         "" as `0x${string}`,
  },
} as const

export type SupportedChainId = keyof typeof CONTRACTS  // 11142220 | 42220

export function getContracts(chainId: number) {
  const c = CONTRACTS[chainId as SupportedChainId]
  if (!c) throw new Error(`Unsupported chainId: ${chainId}`)
  return c
}

/**
 * Returns a single contract address by name.
 * Throws if address is empty (contract not yet deployed).
 */
export function getDeployedAddress(
  chainId: number,
  name:    keyof typeof CONTRACTS[SupportedChainId],
): `0x${string}` {
  const c = getContracts(chainId)
  const addr = c[name]
  if (!addr) {
    throw new Error(
      `Contract "${name}" not deployed on chain ${chainId}.\n` +
      `Run: pnpm contracts:deploy:${chainId === 42220 ? "mainnet" : "sepolia"}`
    )
  }
  return addr
}
