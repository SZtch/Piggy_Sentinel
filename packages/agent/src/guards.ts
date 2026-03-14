import { IS_MAINNET, CHAIN_ID } from "@piggy/config/chains";
import { logger } from "@piggy/shared";

export function enforceChainGuards(): void {
  const appEnv  = process.env.APP_ENV ?? "dev";
  const enabled = process.env.ENABLE_MAINNET_EXECUTION === "true";

  logger.info(`━━ Chain context ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  logger.info(`  APP_ENV  : ${appEnv}`);
  logger.info(`  Chain ID : ${CHAIN_ID}`);
  logger.info(`  Network  : ${IS_MAINNET ? "⚠️  CELO MAINNET" : "Celo Sepolia (testnet)"}`);
  logger.info(`  Mainnet execution : ${enabled}`);
  logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  if (IS_MAINNET && !enabled) {
    throw new Error(
      "[guards] Mainnet execution is BLOCKED.\n" +
      "  Set ENABLE_MAINNET_EXECUTION=true in .env to allow mainnet transactions.\n" +
      "  Never set this flag during development."
    );
  }

  if (IS_MAINNET && process.env.NODE_ENV === "development") {
    throw new Error(
      "[guards] Mainnet transactions blocked when NODE_ENV=development.\n" +
      "  Set NODE_ENV=production for mainnet deployments."
    );
  }
}

export function assertMainnetGate(): void {
  if (IS_MAINNET && process.env.ENABLE_MAINNET_EXECUTION !== "true") {
    throw new Error("[guards] Mainnet transaction attempted without ENABLE_MAINNET_EXECUTION=true");
  }
}
