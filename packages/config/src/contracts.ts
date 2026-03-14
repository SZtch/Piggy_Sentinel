// ─────────────────────────────────────────────────────────────────────────────
// @piggy/config — Deployed Contract Addresses
//
// Populated from env vars after `forge deploy`.
// Env vars are set in .env (production) or .env.fork (local fork).
// ─────────────────────────────────────────────────────────────────────────────

import type { Address } from "viem";

export type DeployedContractName =
  | "sentinelExecutor"
  | "aaveAdapter"
  | "mentoAdapter"
  | "uniswapAdapter"
  | "aaveOracleWrapper";

type ContractRegistry = Record<number, Partial<Record<DeployedContractName, Address>>>;

// Lazily built from env vars at runtime (not at import time)
// so the same build works across envs (fork, testnet, mainnet).
function buildRegistry(): ContractRegistry {
  const get = (envKey: string): Address | undefined => {
    const val = process.env[envKey];
    if (!val || val.startsWith("0x_") || val === "0x0000000000000000000000000000000000000000") {
      return undefined;
    }
    return val as Address;
  };

  const contracts = {
    sentinelExecutor: get("SENTINEL_EXECUTOR_ADDRESS"),
    aaveAdapter:      get("AAVE_ADAPTER_ADDRESS"),
    mentoAdapter:     get("MENTO_ADAPTER_ADDRESS"),
    uniswapAdapter:   get("UNISWAP_ADAPTER_ADDRESS"),
    aaveOracleWrapper:get("AAVE_ORACLE_WRAPPER_ADDRESS"),
  };

  return {
    // Both mainnet (42220) and Anvil fork (42220) use the same env vars
    42220: contracts,
    // Alfajores uses same env vars — deploy a separate set if needed
    44787: contracts,
  };
}

/**
 * Get the deployed address for a contract on the given chain.
 *
 * Returns undefined if the contract hasn't been deployed yet
 * (env var missing or still set to placeholder).
 *
 * Call sites should guard:
 *   const addr = getDeployedAddress(CHAIN_ID, "sentinelExecutor");
 *   if (!addr) throw new Error("SentinelExecutor not deployed");
 */
export function getDeployedAddress(
  chainId:      number,
  contractName: DeployedContractName,
): Address {
  const registry = buildRegistry();
  const chainContracts = registry[chainId];
  if (!chainContracts) {
    throw new Error(`@piggy/config/contracts: no contracts registered for chainId ${chainId}`);
  }

  const addr = chainContracts[contractName];
  if (!addr) {
    throw new Error(
      `@piggy/config/contracts: "${contractName}" not deployed on chain ${chainId}. ` +
      `Run ./scripts/fork/deploy-to-fork.sh and fill .env contract addresses.`
    );
  }

  return addr;
}

/**
 * Like getDeployedAddress but returns undefined instead of throwing.
 * Useful for optional features (e.g. Uniswap adapter may not be deployed yet).
 */
export function tryGetDeployedAddress(
  chainId:      number,
  contractName: DeployedContractName,
): Address | undefined {
  try {
    return getDeployedAddress(chainId, contractName);
  } catch {
    return undefined;
  }
}
