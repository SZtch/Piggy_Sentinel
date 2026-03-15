// ─────────────────────────────────────────────────────────────────────────────
// @piggy/db — Public API
// ─────────────────────────────────────────────────────────────────────────────

export { db } from "./client.js";
export * from "./schema.js";
export { chatCounts } from "./schema.js";

export type { Goal, Execution, AgentEvent, Notification, TelegramLink } from "./queries.js";
export {
  // Users
  upsertUser,

  // Agent wallets
  upsertAgentWallet,

  // Goals
  createGoal,
  getGoalById,
  getActiveGoalByOwner,
  getAllActiveGoals,
  updateGoalStatus,
  setGoalActionRequired,
  clearGoalActionRequired,
  setSoftPausedByOwner,
  setSoftPausedById,
  updateGoalAfterCycle,
  getRecentHistory,

  // Executions
  insertExecution,
  updateExecution,

  // Agent events (idle/running/blocked/success/failed)
  insertAgentEvent,
  getLatestAgentEvent,
  getRecentAgentEvents,

  // Snapshots
  insertSnapshot,

  // Notifications
  insertNotification,
  getPendingNotifications,
  markNotificationSent,

  // Telegram
  createTelegramLink,
  confirmTelegramLink,
  getTelegramChatId,
  getWalletForChatId,

  // x402 payments
  isPaymentUsed,
  markPaymentUsed,
} from "./queries.js";
