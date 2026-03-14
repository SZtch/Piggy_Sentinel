// ─────────────────────────────────────────────────────────────────────────────
// @piggy/shared — Contract ABIs
//
// SentinelExecutor is the on-chain agent proxy. All agent actions
// (Aave supply/withdraw, Mento swap, LP management, spend epoch reset)
// are routed through this contract.
// ─────────────────────────────────────────────────────────────────────────────

export const SENTINEL_EXECUTOR_ABI = [
  // ── Aave ──────────────────────────────────────────────────────────────────
  {
    type:             "function",
    name:             "executeAaveSupply",
    stateMutability:  "nonpayable",
    inputs: [
      { name: "user",      type: "address" },
      { name: "asset",     type: "address" },
      { name: "amount",    type: "uint256" },
      { name: "minReturn", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type:             "function",
    name:             "executeAaveWithdraw",
    stateMutability:  "nonpayable",
    inputs: [
      { name: "user",      type: "address" },
      { name: "asset",     type: "address" },
      { name: "amount",    type: "uint256" },
    ],
    outputs: [],
  },

  {
    type:             "function",
    name:             "rebalance",
    stateMutability:  "nonpayable",
    inputs: [{ name: "userWallet", type: "address" }],
    outputs: [],
  },

  {
    type:             "function",
    name:             "rebalance",
    stateMutability:  "nonpayable",
    inputs: [{ name: "userWallet", type: "address" }],
    outputs: [],
  },

  // ── Mento ─────────────────────────────────────────────────────────────────
  {
    type:             "function",
    name:             "executeMentoSwap",
    stateMutability:  "nonpayable",
    inputs: [
      { name: "user",         type: "address" },
      { name: "fromToken",    type: "address" },
      { name: "toToken",      type: "address" },
      { name: "amountIn",     type: "uint256" },
      { name: "minAmountOut", type: "uint256" },
    ],
    outputs: [],
  },

  // ── Uniswap LP ────────────────────────────────────────────────────────────
  {
    type:             "function",
    name:             "executeUniswapSwap",
    stateMutability:  "nonpayable",
    inputs: [
      { name: "user",      type: "address" },
      { name: "tokenIn",   type: "address" },
      { name: "tokenOut",  type: "address" },
      { name: "amountIn",  type: "uint256" },
      { name: "minOut",    type: "uint256" },
    ],
    outputs: [],
  },
  {
    type:             "function",
    name:             "executeUniswapLP",
    stateMutability:  "nonpayable",
    inputs: [
      { name: "user",         type: "address" },
      { name: "token0",       type: "address" },
      { name: "token1",       type: "address" },
      { name: "amount0",      type: "uint256" },
      { name: "amount1",      type: "uint256" },
      { name: "totalUSD",     type: "uint256" },
      { name: "portfolioUSD", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type:             "function",
    name:             "checkAndExitLPIfIL",
    stateMutability:  "nonpayable",
    inputs: [
      { name: "user",          type: "address" },
      { name: "currentValues", type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    type:             "function",
    name:             "lpPositions",
    stateMutability:  "view",
    inputs: [
      { name: "user",  type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [
      {
        name:       "",
        type:       "tuple",
        components: [
          { name: "pool",            type: "address" },
          { name: "tokenId",         type: "uint256" },
          { name: "entryValueUSD",   type: "uint256" },
          { name: "entryTimestamp",  type: "uint256" },
        ],
      },
    ],
  },

  // ── Spend epoch ───────────────────────────────────────────────────────────
  {
    type:             "function",
    name:             "resetSpendEpoch",
    stateMutability:  "nonpayable",
    inputs: [
      { name: "user", type: "address" },
    ],
    outputs: [],
  },

  // ── View helpers ──────────────────────────────────────────────────────────
  {
    type:             "function",
    name:             "spendLimitOf",
    stateMutability:  "view",
    inputs: [
      { name: "user", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type:             "function",
    name:             "cumulativeSpentOf",
    stateMutability:  "view",
    inputs: [
      { name: "user", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type:             "function",
    name:             "epochStartOf",
    stateMutability:  "view",
    inputs: [
      { name: "user", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type:             "function",
    name:             "agentOf",
    stateMutability:  "view",
    inputs: [
      { name: "user", type: "address" },
    ],
    outputs: [{ name: "", type: "address" }],
  },

  // ── Events ────────────────────────────────────────────────────────────────
  {
    type:   "event",
    name:   "AaveSupplyExecuted",
    inputs: [
      { name: "user",   type: "address", indexed: true  },
      { name: "asset",  type: "address", indexed: true  },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type:   "event",
    name:   "MentoSwapExecuted",
    inputs: [
      { name: "user",      type: "address", indexed: true  },
      { name: "fromToken", type: "address", indexed: false },
      { name: "toToken",   type: "address", indexed: false },
      { name: "amountIn",  type: "uint256", indexed: false },
      { name: "amountOut", type: "uint256", indexed: false },
    ],
  },
  {
    type:   "event",
    name:   "LPExited",
    inputs: [
      { name: "user",    type: "address", indexed: true  },
      { name: "tokenId", type: "uint256", indexed: false },
      { name: "ilPct",   type: "uint256", indexed: false },
    ],
  },
  {
    type:   "event",
    name:   "SpendEpochReset",
    inputs: [
      { name: "user",         type: "address", indexed: true },
      { name: "epochStart",   type: "uint256", indexed: false },
    ],
  },

  // ── Errors ────────────────────────────────────────────────────────────────
  { type: "error", name: "SpendLimitExceeded",   inputs: [] },
  { type: "error", name: "NotAuthorizedAgent",   inputs: [] },
  { type: "error", name: "SlippageExceeded",     inputs: [] },
  { type: "error", name: "InsufficientBalance",  inputs: [] },
] as const;
