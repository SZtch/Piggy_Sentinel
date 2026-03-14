// ABIs generated from `pnpm contracts:build`. Kept inline for portability.
// IMPORTANT: Must stay in sync with packages/contracts/src/SentinelExecutor.sol

// ── AgentWallet ABI (legacy, kept for reference) ──────────────────────────
export const AGENT_WALLET_ABI = [
  { type: "constructor", inputs: [
    { name: "_owner",      type: "address" },
    { name: "_executor",   type: "address" },
    { name: "_spendLimit", type: "uint256" },
  ]},
  { type: "function", name: "owner",               inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "authorizedExecutor",  inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "paused",              inputs: [], outputs: [{ type: "bool" }],    stateMutability: "view" },
  { type: "function", name: "spendLimit",          inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "cumulativeSpent",     inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "setAuthorizedExecutor", inputs: [{ name: "_executor", type: "address" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "setPaused",           inputs: [{ name: "_paused",   type: "bool" }],    outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "setSpendLimit",       inputs: [{ name: "_limit",    type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "resetEpoch",          inputs: [], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "rescueTokens",        inputs: [
    { name: "token",  type: "address" },
    { name: "to",     type: "address" },
    { name: "amount", type: "uint256" },
  ], outputs: [], stateMutability: "nonpayable" },
  { type: "event", name: "PausedStateChanged", inputs: [{ name: "paused", type: "bool", indexed: false }] },
  { type: "event", name: "ExecutorUpdated",    inputs: [
    { name: "oldExecutor", type: "address", indexed: false },
    { name: "newExecutor", type: "address", indexed: false },
  ]},
  { type: "error", name: "NotOwner" },
  { type: "error", name: "NotExecutor" },
  { type: "error", name: "AgentPaused" },
] as const;

// ── SentinelExecutor ABI — matches SentinelExecutor.sol exactly ───────────
export const SENTINEL_EXECUTOR_ABI = [
  // ── Admin ──────────────────────────────────────────────────────────────
  { type: "function", name: "pause",   inputs: [], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "unpause", inputs: [], outputs: [], stateMutability: "nonpayable" },
  // AUTONOMY FIX: reset spend epoch so agent can operate indefinitely
  { type: "function", name: "resetSpendEpoch", inputs: [{ name: "userWallet", type: "address" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "setAgentSigner",      inputs: [{ name: "_agentSigner", type: "address" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "setTreasury",         inputs: [{ name: "_treasury",    type: "address" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "setPriceOracle",      inputs: [{ name: "oracle",       type: "address" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "setWhitelistedAsset", inputs: [{ name: "asset", type: "address" }, { name: "status", type: "bool" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "setVolatileAssets",   inputs: [{ name: "_wETH",  type: "address" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "setDefaultAllocation", inputs: [
    { name: "stableBps", type: "uint256" },
    { name: "lpBps",     type: "uint256" },
    { name: "wethBps",   type: "uint256" },
  ], outputs: [], stateMutability: "nonpayable" },

  // ── State views ────────────────────────────────────────────────────────
  { type: "function", name: "owner",             inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "agentSigner",       inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "treasury",          inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "paused",            inputs: [], outputs: [{ type: "bool"    }], stateMutability: "view" },
  { type: "function", name: "whitelistedAssets", inputs: [{ name: "", type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  // Read LP positions array for a user — used by IL check in agent cycle
  {
    type: "function", name: "lpPositions",
    inputs: [{ name: "user", type: "address" }, { name: "index", type: "uint256" }],
    outputs: [
      { name: "pool",           type: "address" },
      { name: "tokenId",        type: "uint256" },
      { name: "entryValueUSD",  type: "uint256" },
      { name: "entryTimestamp", type: "uint256" },
    ],
    stateMutability: "view",
  },

  // ── User: Register Goal ──────────────────────────────────────────────────
  {
    type: "function", name: "registerGoal",
    inputs: [
      { name: "asset",        type: "address" },
      { name: "amount",       type: "uint256" },
      { name: "goalTarget",   type: "uint256" },
      { name: "goalDeadline", type: "uint256" },
      { name: "spendLimit",   type: "uint256" },
      { name: "stableBps",    type: "uint256" },
      { name: "lpBps",        type: "uint256" },
      { name: "wethBps",      type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },

  // ── User: Pause / Resume ───────────────────────────────────────────────
  { type: "function", name: "setUserPaused", inputs: [{ name: "_paused", type: "bool" }], outputs: [], stateMutability: "nonpayable" },

  // ── Agent: Aave withdraw (for rebalancing — partial exit, funds back to user) ─
  // FIX: replaces incorrect use of user-only withdraw() in rebalance calldata.
  {
    type: "function", name: "executeAaveWithdraw",
    inputs: [
      { name: "userWallet", type: "address" },
      { name: "asset",      type: "address" },
      { name: "amount",     type: "uint256" },
    ],
    outputs: [{ name: "withdrawn", type: "uint256" }],
    stateMutability: "nonpayable",
  },

  // ── Agent: Aave supply ─────────────────────────────────────────────────
  // Signature: executeAaveSupply(address userWallet, address asset, uint256 amount, uint256 minOut)
  {
    type: "function", name: "executeAaveSupply",
    inputs: [
      { name: "userWallet", type: "address" },
      { name: "asset",      type: "address" },
      { name: "amount",     type: "uint256" },
      { name: "minOut",     type: "uint256" },
    ],
    outputs: [{ name: "aTokensReceived", type: "uint256" }],
    stateMutability: "nonpayable",
  },

  // ── Agent: Uniswap LP entry ────────────────────────────────────────────
  {
    type: "function", name: "executeUniswapLP",
    inputs: [
      { name: "userWallet",        type: "address" },
      { name: "token0",            type: "address" },
      { name: "token1",            type: "address" },
      { name: "amount0",           type: "uint256" },
      { name: "amount1",           type: "uint256" },
      { name: "totalValueUSD",     type: "uint256" },
      { name: "totalPortfolioUSD", type: "uint256" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
    stateMutability: "nonpayable",
  },

  // ── Agent: Uniswap swap (WETH swaps — NEVER use Mento for WETH) ──────
  {
    type: "function", name: "executeUniswapSwap",
    inputs: [
      { name: "userWallet",   type: "address" },
      { name: "fromAsset",    type: "address" },
      { name: "toAsset",      type: "address" },
      { name: "amountIn",     type: "uint256" },
      { name: "minAmountOut", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "nonpayable",
  },

  // ── Agent: IL stop-loss ────────────────────────────────────────────────
  {
    type: "function", name: "checkAndExitLPIfIL",
    inputs: [
      { name: "userWallet",    type: "address"   },
      { name: "currentValues", type: "uint256[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },

  // ── Agent: Rebalance gate (records timestamp on-chain, max once per 24h) ──
  {
    type: "function", name: "rebalance",
    inputs: [{ name: "userWallet", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },

  // ── Agent: Mento stable swap (USDm ↔ USDC / USDT only — NEVER for WETH) ──
  {
    type: "function", name: "executeMentoSwap",
    inputs: [
      { name: "userWallet",   type: "address" },
      { name: "fromAsset",    type: "address" },
      { name: "toAsset",      type: "address" },
      { name: "amountIn",     type: "uint256" },
      { name: "minAmountOut", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "nonpayable",
  },

  // ── User: Withdraw (always callable, even when paused) ────────────────
  {
    type: "function", name: "withdraw",
    inputs: [
      { name: "aaveAssets",  type: "address[]" },
      { name: "aaveAmounts", type: "uint256[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },

  // ── Agent: Emergency withdraw (only callable when contract is paused) ─
  {
    type: "function", name: "emergencyWithdraw",
    inputs: [
      { name: "userWallet",  type: "address"   },
      { name: "aaveAssets",  type: "address[]" },
      { name: "aaveAmounts", type: "uint256[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },

  // ── Position view ──────────────────────────────────────────────────────
  {
    type: "function", name: "positions",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "principalDeposited", type: "uint256" },
      { name: "lastRebalancedAt",   type: "uint256" },
      { name: "userPaused",         type: "bool"    },
      { name: "goalTarget",         type: "uint256" },
      { name: "goalDeadline",       type: "uint256" },
      { name: "spendLimit",         type: "uint256" },
      { name: "cumulativeSpent",    type: "uint256" },
      { name: "epochStart",         type: "uint256" },
    ],
    stateMutability: "view",
  },

  // ── Events ────────────────────────────────────────────────────────────
  { type: "event", name: "Paused",   inputs: [{ name: "by",    type: "address", indexed: true }] },
  { type: "event", name: "Unpaused", inputs: [{ name: "by",    type: "address", indexed: true }] },
  { type: "event", name: "AgentSignerUpdated", inputs: [
    { name: "oldSigner", type: "address", indexed: true },
    { name: "newSigner", type: "address", indexed: true },
  ]},
  { type: "event", name: "GoalRegistered",  inputs: [
    { name: "user",   type: "address", indexed: true },
    { name: "asset",  type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ]},
  { type: "event", name: "Withdraw", inputs: [
    { name: "user",   type: "address", indexed: true },
    { name: "asset",  type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ]},
  { type: "event", name: "GoalCompleted", inputs: [
    { name: "user",          type: "address", indexed: true },
    { name: "totalReturned", type: "uint256", indexed: false },
    { name: "feeTaken",      type: "uint256", indexed: false },
  ]},
  { type: "event", name: "EmergencyWithdraw", inputs: [
    { name: "user",   type: "address", indexed: true },
    { name: "asset",  type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ]},
  { type: "event", name: "StrategyExecuted", inputs: [
    { name: "user",     type: "address", indexed: true },
    { name: "asset",    type: "address", indexed: true },
    { name: "amount",   type: "uint256", indexed: false },
    { name: "protocol", type: "string",  indexed: false },
  ]},
  { type: "event", name: "Rebalanced", inputs: [{ name: "user", type: "address", indexed: true }] },
  { type: "event", name: "LPEntered",  inputs: [
    { name: "user",     type: "address", indexed: true },
    { name: "tokenId",  type: "uint256", indexed: false },
    { name: "valueUSD", type: "uint256", indexed: false },
  ]},
  { type: "event", name: "LPExited",   inputs: [
    { name: "user",    type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: false },
    { name: "reason",  type: "string",  indexed: false },
  ]},
  { type: "event", name: "AllocationSet", inputs: [
    { name: "user",      type: "address", indexed: true },
    { name: "stableBps", type: "uint256", indexed: false },
    { name: "lpBps",     type: "uint256", indexed: false },
    { name: "wethBps",   type: "uint256", indexed: false },
  ]},
  { type: "event", name: "AssetWhitelisted",  inputs: [{ name: "asset",  type: "address", indexed: true }, { name: "status", type: "bool",    indexed: false }] },
  { type: "event", name: "GuardrailTripped",  inputs: [{ name: "user",   type: "address", indexed: true }, { name: "reason", type: "string",  indexed: false }] },
  { type: "event", name: "OracleUpdated",     inputs: [{ name: "oracle", type: "address", indexed: true }] },

  // ── Custom errors ─────────────────────────────────────────────────────
  { type: "error", name: "NotOwner"    },
  { type: "error", name: "NotAgent"    },
  { type: "error", name: "NotUser"     },
  { type: "error", name: "ContractPaused" },
  { type: "error", name: "NotPaused"   },
  { type: "error", name: "ZeroAmount"  },
  { type: "error", name: "NoPosition"  },
  { type: "error", name: "OracleNotSet" },
  { type: "error", name: "AssetNotWhitelisted",        inputs: [{ name: "asset",      type: "address" }] },
  { type: "error", name: "UserPositionPaused",         inputs: [{ name: "user",       type: "address" }] },
  { type: "error", name: "RebalanceTooSoon",           inputs: [{ name: "nextAllowed", type: "uint256" }] },
  { type: "error", name: "LPAllocationExceeded",       inputs: [{ name: "requested",  type: "uint256" }, { name: "max",       type: "uint256" }] },
  { type: "error", name: "VolatileAllocationExceeded", inputs: [{ name: "requested",  type: "uint256" }, { name: "max",       type: "uint256" }] },
  { type: "error", name: "AllocationSumInvalid",       inputs: [{ name: "sum",        type: "uint256" }] },
  { type: "error", name: "SlippageExceeded",           inputs: [{ name: "actual",     type: "uint256" }, { name: "max",       type: "uint256" }] },
  { type: "error", name: "SpendLimitExceeded",         inputs: [{ name: "requested",  type: "uint256" }, { name: "remaining", type: "uint256" }] },
] as const;

export const ERC20_ABI = [
  { type: "function", name: "approve",     inputs: [{ name: "spender", type: "address" }, { name: "amount",  type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { type: "function", name: "allowance",   inputs: [{ name: "owner",   type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "balanceOf",   inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "transfer",    inputs: [{ name: "to",      type: "address" }, { name: "amount",  type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { type: "function", name: "transferFrom",inputs: [{ name: "from",    type: "address" }, { name: "to",      type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
] as const;
