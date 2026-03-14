// ─────────────────────────────────────────────────────────────────────────────
// @piggy/config — Public API
// ─────────────────────────────────────────────────────────────────────────────

export {
  celoMainnet,
  celoAlfajores,
  activeChain,
  IS_MAINNET,
  CHAIN_ID,
  RPC_URL,
} from "./chains.js";

export type { TokenSymbol } from "./tokens.js";
export {
  getTokenAddress,
  getAllTokenAddresses,
  getTokenDecimals,
} from "./tokens.js";

export type { DeployedContractName } from "./contracts.js";
export {
  getDeployedAddress,
  tryGetDeployedAddress,
} from "./contracts.js";
