// ─────────────────────────────────────────────────────────────────────────────
// @piggy/shared — Contract ABIs
//
// SYNC CONTRACT: packages/contracts/src/SentinelExecutor.sol
// Setiap kali kontrak berubah, ABI ini HARUS diupdate bersamaan.
// ─────────────────────────────────────────────────────────────────────────────

export const SENTINEL_EXECUTOR_ABI = [

  // ── Aave ──────────────────────────────────────────────────────────────────
  {
    type:            "function",
    name:            "executeAaveSupply",
    stateMutability: "nonpayable",
    inputs: [
      { name: "userWallet", type: "address" },
      { name: "asset",      type: "address" },
      { name: "amount",     type: "uint256" },
      { name: "minOut",     type: "uint256" },
    ],
    outputs: [{ name: "aTokensReceived", type: "uint256" }],
  },
  {
    type:            "function",
    name:            "executeAaveWithdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "userWallet", type: "address" },
      { name: "asset",      type: "address" },
      { name: "amount",     type: "uint256" },
    ],
    outputs: [{ name: "withdrawn", type: "uint256" }],
  },

  // ── Mento ─────────────────────────────────────────────────────────────────
  {
    // Atomic: swap USDm → USDC/USDT via Mento, kemudian supply hasil swap ke Aave.
    // Gunakan ini untuk allocation — 1 tx, tidak perlu user approve USDC/USDT.
    type:            "function",
    name:            "executeMentoSwapAndSupply",
    stateMutability: "nonpayable",
    inputs: [
      { name: "userWallet",    type: "address" },
      { name: "fromAsset",     type: "address" },
      { name: "toAsset",       type: "address" },
      { name: "amountIn",      type: "uint256" },
      { name: "minAmountOut",  type: "uint256" },
      { name: "minATokens",    type: "uint256" },
    ],
    outputs: [
      { name: "amountOut",       type: "uint256" },
      { name: "aTokensReceived", type: "uint256" },
    ],
  },
  {
    // Standalone swap — output ke userWallet.
    // Hanya dipakai untuk rebalancing keluar dari Aave (withdraw dulu, lalu swap).
    type:            "function",
    name:            "executeMentoSwap",
    stateMutability: "nonpayable",
    inputs: [
      { name: "userWallet",   type: "address" },
      { name: "fromAsset",    type: "address" },
      { name: "toAsset",      type: "address" },
      { name: "amountIn",     type: "uint256" },
      { name: "minAmountOut", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },

  // ── Uniswap ───────────────────────────────────────────────────────────────
  {
    type:            "function",
    name:            "executeUniswapSwap",
    stateMutability: "nonpayable",
    inputs: [
      { name: "userWallet",   type: "address" },
      { name: "fromAsset",    type: "address" },
      { name: "toAsset",      type: "address" },
      { name: "amountIn",     type: "uint256" },
      { name: "minAmountOut", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    type:            "function",
    name:            "executeUniswapLP",
    stateMutability: "nonpayable",
    inputs: [
      { name: "userWallet",        type: "address" },
      { name: "token0",            type: "address" },
      { name: "token1",            type: "address" },
      { name: "amount0",           type: "uint256" },
      { name: "amount1",           type: "uint256" },
      { name: "amount0Min",        type: "uint256" },
      { name: "amount1Min",        type: "uint256" },
      { name: "totalValueUSD",     type: "uint256" },
      { name: "totalPortfolioUSD", type: "uint256" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type:            "function",
    name:            "checkAndExitLPIfIL",
    stateMutability: "nonpayable",
    inputs: [
      { name: "userWallet",    type: "address" },
      { name: "currentValues", type: "uint256[]" },
    ],
    outputs: [],
  },

  // ── Rebalance gate ────────────────────────────────────────────────────────
  {
    type:            "function",
    name:            "rebalance",
    stateMutability: "nonpayable",
    inputs: [{ name: "userWallet", type: "address" }],
    outputs: [],
  },

  // ── Withdraw (user) ───────────────────────────────────────────────────────
  {
    // User tarik SEMUA dana. Amount diambil otomatis dari userATokenShares.
    // Output diconvert ke USDm via Mento sebelum dikirim ke user.
    // Tidak ada parameter amount — tidak bisa dimanipulasi.
    type:            "function",
    name:            "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "aaveAssets", type: "address[]" },  // [USDm, USDC, USDT]
    ],
    outputs: [],
  },

  // ── Emergency withdraw (agent, only when paused) ──────────────────────────
  {
    type:            "function",
    name:            "emergencyWithdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "userWallet", type: "address"   },
      { name: "aaveAssets", type: "address[]" },  // [USDm, USDC, USDT]
    ],
    outputs: [],
  },

  // ── Forward to user (setelah LP sequence) ───────────────────────────────
  {
    // Agent forward sisa token parkir di SentinelExecutor ke userWallet.
    // Dipanggil setelah executeAaveWithdraw + swap/LP sequence selesai.
    type:            "function",
    name:            "forwardToUser",
    stateMutability: "nonpayable",
    inputs: [
      { name: "userWallet", type: "address"   },
      { name: "assets",     type: "address[]" },
    ],
    outputs: [],
  },

  // ── Spend epoch ───────────────────────────────────────────────────────────
  {
    type:            "function",
    name:            "resetSpendEpoch",
    stateMutability: "nonpayable",
    inputs: [{ name: "userWallet", type: "address" }],
    outputs: [],
  },

  // ── View: per-user state ──────────────────────────────────────────────────
  {
    // Jumlah aToken yang dimiliki user untuk asset tertentu.
    // Gunakan ini untuk baca Aave balance per-user — BUKAN balanceOf(executor).
    type:            "function",
    name:            "userATokenShares",
    stateMutability: "view",
    inputs: [
      { name: "user",  type: "address" },
      { name: "asset", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type:            "function",
    name:            "positions",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "principalDeposited", type: "uint256" },
          { name: "lastRebalancedAt",   type: "uint256" },
          { name: "userPaused",         type: "bool"    },
          { name: "goalTarget",         type: "uint256" },
          { name: "goalDeadline",       type: "uint256" },
          { name: "spendLimit",         type: "uint256" },
          { name: "cumulativeSpent",    type: "uint256" },
          { name: "epochStart",         type: "uint256" },
        ],
      },
    ],
  },
  {
    type:            "function",
    name:            "lpPositions",
    stateMutability: "view",
    inputs: [
      { name: "user",  type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "pool",           type: "address" },
          { name: "tokenId",        type: "uint256" },
          { name: "entryValueUSD",  type: "uint256" },
          { name: "entryTimestamp", type: "uint256" },
        ],
      },
    ],
  },
  {
    type:            "function",
    name:            "isAllowanceValid",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },

  // ── Events ────────────────────────────────────────────────────────────────
  {
    type:   "event",
    name:   "StrategyExecuted",
    inputs: [
      { name: "user",     type: "address", indexed: true  },
      { name: "asset",    type: "address", indexed: true  },
      { name: "amount",   type: "uint256", indexed: false },
      { name: "protocol", type: "string",  indexed: false },
    ],
  },
  {
    type:   "event",
    name:   "Withdraw",
    inputs: [
      { name: "user",   type: "address", indexed: true  },
      { name: "asset",  type: "address", indexed: true  },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type:   "event",
    name:   "GoalCompleted",
    inputs: [
      { name: "user",          type: "address", indexed: true  },
      { name: "totalReturned", type: "uint256", indexed: false },
      { name: "feeTaken",      type: "uint256", indexed: false },
    ],
  },
  {
    type:   "event",
    name:   "Rebalanced",
    inputs: [
      { name: "user", type: "address", indexed: true },
    ],
  },
  {
    type:   "event",
    name:   "LPEntered",
    inputs: [
      { name: "user",     type: "address", indexed: true  },
      { name: "tokenId",  type: "uint256", indexed: false },
      { name: "valueUSD", type: "uint256", indexed: false },
    ],
  },
  {
    type:   "event",
    name:   "LPExited",
    inputs: [
      { name: "user",    type: "address", indexed: true  },
      { name: "tokenId", type: "uint256", indexed: false },
      { name: "reason",  type: "string",  indexed: false },
    ],
  },
  {
    type:   "event",
    name:   "GoalRegistered",
    inputs: [
      { name: "user",   type: "address", indexed: true  },
      { name: "asset",  type: "address", indexed: true  },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type:   "event",
    name:   "Paused",
    inputs: [{ name: "by", type: "address", indexed: true }],
  },
  {
    type:   "event",
    name:   "Unpaused",
    inputs: [{ name: "by", type: "address", indexed: true }],
  },

  // ── Errors ────────────────────────────────────────────────────────────────
  { type: "error", name: "NotOwner",                inputs: [] },
  { type: "error", name: "NotAgent",                inputs: [] },
  { type: "error", name: "NotUser",                 inputs: [] },
  { type: "error", name: "ContractPaused",          inputs: [] },
  { type: "error", name: "NotPaused",               inputs: [] },
  { type: "error", name: "AssetNotWhitelisted",     inputs: [{ name: "asset", type: "address" }] },
  { type: "error", name: "UserPositionPaused",      inputs: [{ name: "user",  type: "address" }] },
  { type: "error", name: "RebalanceTooSoon",        inputs: [{ name: "nextAllowed", type: "uint256" }] },
  { type: "error", name: "LPAllocationExceeded",    inputs: [{ name: "requested", type: "uint256" }, { name: "max", type: "uint256" }] },
  { type: "error", name: "VolatileAllocationExceeded", inputs: [{ name: "requested", type: "uint256" }, { name: "max", type: "uint256" }] },
  { type: "error", name: "AllocationSumInvalid",    inputs: [{ name: "sum", type: "uint256" }] },
  { type: "error", name: "SlippageExceeded",        inputs: [{ name: "actual", type: "uint256" }, { name: "max", type: "uint256" }] },
  { type: "error", name: "SpendLimitExceeded",      inputs: [{ name: "requested", type: "uint256" }, { name: "remaining", type: "uint256" }] },
  { type: "error", name: "ZeroAmount",              inputs: [] },
  { type: "error", name: "NoPosition",              inputs: [] },
  { type: "error", name: "OracleNotSet",            inputs: [] },
  { type: "error", name: "AllowanceExpired",        inputs: [] },
] as const;
