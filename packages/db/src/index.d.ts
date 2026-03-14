export { db } from "./client.js";
export * from "./schema.js";
export type { Goal, Execution, AgentEvent, Notification, TelegramLink } from "./queries.js";
export { upsertUser, upsertAgentWallet, createGoal, getGoalById, getActiveGoalByOwner, getAllActiveGoals, updateGoalStatus, setGoalActionRequired, clearGoalActionRequired, setSoftPausedByOwner, updateGoalAfterCycle, getRecentHistory, insertExecution, updateExecution, insertAgentEvent, getLatestAgentEvent, getRecentAgentEvents, insertSnapshot, insertNotification, getPendingNotifications, markNotificationSent, createTelegramLink, confirmTelegramLink, getTelegramChatId, getWalletForChatId, isPaymentUsed, markPaymentUsed, } from "./queries.js";
//# sourceMappingURL=index.d.ts.map