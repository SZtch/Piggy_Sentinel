import { goals, executions, agentEvents, notifications, telegramLinks } from "./schema.js";
export type Goal = typeof goals.$inferSelect;
export type Execution = typeof executions.$inferSelect;
export type AgentEvent = typeof agentEvents.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type TelegramLink = typeof telegramLinks.$inferSelect;
export declare function upsertUser(walletAddress: string): Promise<void>;
export declare function upsertAgentWallet(input: {
    contractAddress: string;
    ownerWallet: string;
    executorAddress: string;
    spendLimit: bigint;
}): Promise<void>;
export declare function createGoal(input: {
    ownerWallet: string;
    agentWallet: string;
    targetAmount: bigint;
    targetCurrency: string;
    deadlineDate: Date;
    strategyJson?: unknown;
    goalName?: string;
}): Promise<Goal[]>;
export declare function getGoalById(id: string): Promise<Goal | undefined>;
export declare function getActiveGoalByOwner(walletAddress: string): Promise<Goal | undefined>;
export declare function getAllActiveGoals(): Promise<Goal[]>;
export declare function updateGoalStatus(id: string, status: string): Promise<void>;
/**
 * Mark goal as action_required with a reason.
 * Agent stops executing but goal is not deleted.
 */
export declare function setGoalActionRequired(id: string, reason: string): Promise<void>;
/**
 * Clear action_required — restore to active after user resolves the issue.
 */
export declare function clearGoalActionRequired(id: string): Promise<void>;
export declare function setSoftPausedByOwner(walletAddress: string, softPaused: boolean): Promise<void>;
export declare function updateGoalAfterCycle(id: string, progressPct: number, didRebalance: boolean): Promise<void>;
export declare function getRecentHistory(walletAddress: string): Promise<{
    goals: Goal[];
    executions: Execution[];
}>;
export declare function insertExecution(input: {
    goalId: string;
    agentWallet: string;
    skillName: string;
    status: string;
}): Promise<string>;
export declare function updateExecution(id: string, status: string, txHash?: string): Promise<void>;
export declare function insertAgentEvent(input: {
    goalId: string;
    agentWallet: string;
    status: "idle" | "running" | "blocked" | "success" | "failed" | "skipped" | "paused";
    reason?: string;
}): Promise<void>;
export declare function getLatestAgentEvent(goalId: string): Promise<AgentEvent | undefined>;
export declare function getRecentAgentEvents(goalId: string, limit?: number): Promise<AgentEvent[]>;
export declare function insertSnapshot(goalId: string, balance: bigint, progressPct: number, paceStatus: string): Promise<void>;
export declare function insertNotification(input: {
    goalId: string;
    telegramChatId: string;
    type: string;
    messageText: string;
}): Promise<void>;
export declare function getPendingNotifications(): Promise<Notification[]>;
export declare function markNotificationSent(id: string): Promise<void>;
export declare function createTelegramLink(walletAddress: string, code: string, expiresAt: Date): Promise<void>;
export declare function confirmTelegramLink(code: string, chatId: string): Promise<TelegramLink[]>;
export declare function getTelegramChatId(walletAddress: string): Promise<string | null>;
export declare function getWalletForChatId(chatId: string): Promise<string | null>;
export declare function isPaymentUsed(txHash: string): Promise<boolean>;
export declare function markPaymentUsed(txHash: string, payerAddress: string, amountUsdc: number): Promise<void>;
//# sourceMappingURL=queries.d.ts.map