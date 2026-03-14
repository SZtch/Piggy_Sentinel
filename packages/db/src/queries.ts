// ─────────────────────────────────────────────────────────────────────────────
// @piggy/db — Query Functions
// ─────────────────────────────────────────────────────────────────────────────

import { eq, and, isNull, desc, lt, or } from "drizzle-orm";
import { db } from "./client.js";
import {
  users, agentWallets, goals, executions, agentEvents,
  snapshots, notifications, telegramLinks, usedPayments,
} from "./schema.js";

// ── Types inferred from schema ────────────────────────────────────────────────
export type Goal         = typeof goals.$inferSelect;
export type Execution    = typeof executions.$inferSelect;
export type AgentEvent   = typeof agentEvents.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type TelegramLink = typeof telegramLinks.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────────────────────

export async function upsertUser(walletAddress: string): Promise<void> {
  await db.insert(users).values({ walletAddress }).onConflictDoNothing();
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Wallets
// ─────────────────────────────────────────────────────────────────────────────

export async function upsertAgentWallet(input: {
  contractAddress: string;
  ownerWallet:     string;
  executorAddress: string;
  spendLimit:      bigint;
}): Promise<void> {
  await db
    .insert(agentWallets)
    .values({
      contractAddress: input.contractAddress,
      ownerWallet:     input.ownerWallet,
      executorAddress: input.executorAddress,
      spendLimit:      input.spendLimit.toString(),
    })
    .onConflictDoUpdate({
      target: agentWallets.contractAddress,
      set: {
        executorAddress: input.executorAddress,
        spendLimit:      input.spendLimit.toString(),
        updatedAt:       new Date(),
      },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Goals
// ─────────────────────────────────────────────────────────────────────────────

export async function createGoal(input: {
  ownerWallet:    string;
  agentWallet:    string;
  targetAmount:   bigint;
  targetCurrency: string;
  deadlineDate:   Date;
  strategyJson?:  unknown;
  goalName?:      string;
}): Promise<Goal[]> {
  return db
    .insert(goals)
    .values({
      ownerWallet:    input.ownerWallet,
      agentWallet:    input.agentWallet,
      targetAmount:   input.targetAmount.toString(),
      targetCurrency: input.targetCurrency,
      deadline:       input.deadlineDate,
      status:         "draft",
      goalName:       input.goalName ?? null,
      strategyJson:   input.strategyJson ?? null,
      epochStart:     new Date(),
    })
    .returning();
}

export async function getGoalById(id: string): Promise<Goal | undefined> {
  const rows = await db.select().from(goals).where(eq(goals.id, id)).limit(1);
  return rows[0];
}

export async function getActiveGoalByOwner(walletAddress: string): Promise<Goal | undefined> {
  const rows = await db
    .select()
    .from(goals)
    .where(
      and(
        eq(goals.ownerWallet, walletAddress),
        or(
          eq(goals.status, "active"),
          eq(goals.status, "action_required"),
        ),
      )
    )
    .limit(1);
  return rows[0];
}

export async function getAllActiveGoals(): Promise<Goal[]> {
  return db
    .select()
    .from(goals)
    .where(
      or(
        eq(goals.status, "active"),
        eq(goals.status, "action_required"),
      )
    );
}

export async function updateGoalStatus(id: string, status: string): Promise<void> {
  await db.update(goals).set({ status, updatedAt: new Date() }).where(eq(goals.id, id));
}

/**
 * Mark goal as action_required with a reason.
 * Agent stops executing but goal is not deleted.
 */
export async function setGoalActionRequired(
  id:     string,
  reason: string,
): Promise<void> {
  await db
    .update(goals)
    .set({ status: "action_required", actionReason: reason, softPaused: true, updatedAt: new Date() })
    .where(eq(goals.id, id));
}

/**
 * Clear action_required — restore to active after user resolves the issue.
 */
export async function clearGoalActionRequired(id: string): Promise<void> {
  await db
    .update(goals)
    .set({ status: "active", actionReason: null, softPaused: false, updatedAt: new Date() })
    .where(eq(goals.id, id));
}

export async function setSoftPausedByOwner(
  walletAddress: string,
  softPaused:    boolean,
): Promise<void> {
  await db
    .update(goals)
    .set({ softPaused, updatedAt: new Date() })
    .where(eq(goals.ownerWallet, walletAddress));
}

export async function updateGoalAfterCycle(
  id:           string,
  progressPct:  number,
  didRebalance: boolean,
): Promise<void> {
  await db
    .update(goals)
    .set({
      progressPct:        progressPct.toFixed(2),
      lastRebalancedAt:   didRebalance ? new Date() : undefined,
      lastAllowanceCheck: new Date(),
      updatedAt:          new Date(),
    })
    .where(eq(goals.id, id));
}

export async function getRecentHistory(walletAddress: string): Promise<{
  goals:      Goal[];
  executions: Execution[];
}> {
  const userGoals = await db
    .select()
    .from(goals)
    .where(eq(goals.ownerWallet, walletAddress))
    .orderBy(desc(goals.createdAt))
    .limit(10);

  const goalIds = userGoals.map(g => g.id);
  if (goalIds.length === 0) return { goals: userGoals, executions: [] };

  const recentExecs: Execution[] = [];
  for (const goalId of goalIds.slice(0, 3)) {
    const execs = await db
      .select()
      .from(executions)
      .where(eq(executions.goalId, goalId))
      .orderBy(desc(executions.createdAt))
      .limit(5);
    recentExecs.push(...execs);
  }

  return { goals: userGoals, executions: recentExecs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Executions
// ─────────────────────────────────────────────────────────────────────────────

export async function insertExecution(input: {
  goalId:      string;
  agentWallet: string;
  skillName:   string;
  status:      string;
}): Promise<string> {
  const rows = await db.insert(executions).values(input).returning({ id: executions.id });
  return rows[0]!.id;
}

export async function updateExecution(
  id:      string,
  status:  string,
  txHash?: string,
): Promise<void> {
  await db
    .update(executions)
    .set({ status, txHash: txHash ?? null, updatedAt: new Date() })
    .where(eq(executions.id, id));
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Events
// ─────────────────────────────────────────────────────────────────────────────

export async function insertAgentEvent(input: {
  goalId:      string;
  agentWallet: string;
  status:      "idle" | "running" | "blocked" | "success" | "failed" | "skipped" | "paused";
  reason?:     string;
}): Promise<void> {
  await db.insert(agentEvents).values({
    goalId:      input.goalId,
    agentWallet: input.agentWallet,
    status:      input.status,
    reason:      input.reason ?? null,
  });
}

export async function getLatestAgentEvent(goalId: string): Promise<AgentEvent | undefined> {
  const rows = await db
    .select()
    .from(agentEvents)
    .where(eq(agentEvents.goalId, goalId))
    .orderBy(desc(agentEvents.cycleAt))
    .limit(1);
  return rows[0];
}

export async function getRecentAgentEvents(goalId: string, limit = 10): Promise<AgentEvent[]> {
  return db
    .select()
    .from(agentEvents)
    .where(eq(agentEvents.goalId, goalId))
    .orderBy(desc(agentEvents.cycleAt))
    .limit(limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshots
// ─────────────────────────────────────────────────────────────────────────────

export async function insertSnapshot(
  goalId:      string,
  balance:     bigint,
  progressPct: number,
  paceStatus:  string,
): Promise<void> {
  await db.insert(snapshots).values({
    goalId,
    balance:     balance.toString(),
    progressPct: progressPct.toFixed(2),
    paceStatus,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────────────────

export async function insertNotification(input: {
  goalId:         string;
  telegramChatId: string;
  type:           string;
  messageText:    string;
}): Promise<void> {
  await db.insert(notifications).values({
    goalId:           input.goalId,
    telegramChatId:   input.telegramChatId,
    notificationType: input.type,
    messageText:      input.messageText,
  });
}

export async function getPendingNotifications(): Promise<Notification[]> {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.sent, false))
    .orderBy(notifications.createdAt)
    .limit(50);
}

export async function markNotificationSent(id: string): Promise<void> {
  await db.update(notifications).set({ sent: true, sentAt: new Date() }).where(eq(notifications.id, id));
}

// ─────────────────────────────────────────────────────────────────────────────
// Telegram Links
// ─────────────────────────────────────────────────────────────────────────────

export async function createTelegramLink(
  walletAddress: string,
  code:          string,
  expiresAt:     Date,
): Promise<void> {
  await db.insert(telegramLinks).values({ walletAddress, code, expiresAt }).onConflictDoNothing();
}

export async function confirmTelegramLink(code: string, chatId: string): Promise<TelegramLink[]> {
  const now = new Date();
  return db
    .update(telegramLinks)
    .set({ chatId, confirmedAt: now })
    .where(
      and(
        eq(telegramLinks.code, code),
        isNull(telegramLinks.confirmedAt),
        lt(now, telegramLinks.expiresAt),
      )
    )
    .returning();
}

export async function getTelegramChatId(walletAddress: string): Promise<string | null> {
  const rows = await db
    .select({ chatId: telegramLinks.chatId })
    .from(telegramLinks)
    .where(
      and(
        eq(telegramLinks.walletAddress, walletAddress),
        eq(telegramLinks.chatId, telegramLinks.chatId),
      )
    )
    .orderBy(desc(telegramLinks.confirmedAt))
    .limit(1);
  return rows[0]?.chatId ?? null;
}

export async function getWalletForChatId(chatId: string): Promise<string | null> {
  const rows = await db
    .select({ walletAddress: telegramLinks.walletAddress })
    .from(telegramLinks)
    .where(eq(telegramLinks.chatId, chatId))
    .orderBy(desc(telegramLinks.confirmedAt))
    .limit(1);
  return rows[0]?.walletAddress ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// x402 Payment Replay Protection
// ─────────────────────────────────────────────────────────────────────────────

export async function isPaymentUsed(txHash: string): Promise<boolean> {
  const rows = await db
    .select({ txHash: usedPayments.txHash })
    .from(usedPayments)
    .where(eq(usedPayments.txHash, txHash))
    .limit(1);
  return rows.length > 0;
}

export async function markPaymentUsed(
  txHash:       string,
  payerAddress: string,
  amountUsdc:   number,
): Promise<void> {
  await db
    .insert(usedPayments)
    .values({ txHash, payerAddress, amountUsdc: amountUsdc.toFixed(6) })
    .onConflictDoNothing();
}
