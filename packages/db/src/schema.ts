// ─────────────────────────────────────────────────────────────────────────────
// @piggy/db — Drizzle Schema
// ─────────────────────────────────────────────────────────────────────────────

import {
  pgTable, uuid, text, numeric, boolean,
  timestamp, jsonb, index,
} from "drizzle-orm/pg-core";

// ── users ─────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  walletAddress: text("wallet_address").primaryKey(),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
});

// ── agent_wallets ─────────────────────────────────────────────────────────────
export const agentWallets = pgTable("agent_wallets", {
  contractAddress: text("contract_address").primaryKey(),
  ownerWallet:     text("owner_wallet").notNull().references(() => users.walletAddress),
  executorAddress: text("executor_address").notNull(),
  spendLimit:      numeric("spend_limit", { precision: 78, scale: 0 }).notNull(),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
});

// ── goals ─────────────────────────────────────────────────────────────────────
// status: draft | active | action_required | paused | completed | cancelled | expired
export const goals = pgTable("goals", {
  id:               uuid("id").primaryKey().defaultRandom(),
  ownerWallet:      text("owner_wallet").notNull().references(() => users.walletAddress),
  agentWallet:      text("agent_wallet").notNull(),
  targetAmount:     numeric("target_amount", { precision: 78, scale: 0 }).notNull(),
  targetCurrency:   text("target_currency").notNull(),
  deadline:         timestamp("deadline").notNull(),
  status:           text("status").notNull().default("draft"),
  // action_required context
  actionReason:     text("action_reason"),                        // why action is required
  // optional metadata
  goalName:         text("goal_name"),                            // user-defined name
  strategyJson:     jsonb("strategy_json"),
  progressPct:      numeric("progress_pct", { precision: 5, scale: 2 }).default("0"),
  principalDeposited: numeric("principal_deposited", { precision: 78, scale: 0 }).default("0"),
  monthlyDeposit:   numeric("monthly_deposit",  { precision: 78, scale: 0 }).default("0"),
  lastRebalancedAt: timestamp("last_rebalanced_at"),
  lastAllowanceCheck: timestamp("last_allowance_check"),          // last time allowance was verified
  allowanceExpiresAt: timestamp("allowance_expires_at"),          // optional allowance expiry
  softPaused:       boolean("soft_paused").notNull().default(false),
  epochStart:       timestamp("epoch_start"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  ownerIdx:  index("goals_owner_idx").on(t.ownerWallet),
  statusIdx: index("goals_status_idx").on(t.status),
}));

// ── executions ────────────────────────────────────────────────────────────────
export const executions = pgTable("executions", {
  id:          uuid("id").primaryKey().defaultRandom(),
  goalId:      uuid("goal_id").notNull().references(() => goals.id),
  agentWallet: text("agent_wallet").notNull(),
  skillName:   text("skill_name").notNull(),
  status:      text("status").notNull().default("pending"), // pending | confirmed | failed
  txHash:      text("tx_hash"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  goalIdx: index("executions_goal_idx").on(t.goalId),
}));

// ── agent_events ──────────────────────────────────────────────────────────────
// Tracks per-cycle agent status: idle | running | blocked | success | failed
export const agentEvents = pgTable("agent_events", {
  id:          uuid("id").primaryKey().defaultRandom(),
  goalId:      uuid("goal_id").notNull().references(() => goals.id),
  agentWallet: text("agent_wallet").notNull(),
  status:      text("status").notNull(),   // idle | running | blocked | success | failed
  reason:      text("reason"),             // explanation for blocked/failed
  cycleAt:     timestamp("cycle_at").defaultNow().notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  goalIdx:   index("agent_events_goal_idx").on(t.goalId),
  statusIdx: index("agent_events_status_idx").on(t.status),
  cycleIdx:  index("agent_events_cycle_idx").on(t.cycleAt),
}));

// ── snapshots ─────────────────────────────────────────────────────────────────
export const snapshots = pgTable("snapshots", {
  id:          uuid("id").primaryKey().defaultRandom(),
  goalId:      uuid("goal_id").notNull().references(() => goals.id),
  balance:     numeric("balance", { precision: 78, scale: 0 }).notNull(),
  progressPct: numeric("progress_pct", { precision: 5, scale: 2 }).notNull(),
  paceStatus:  text("pace_status").notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  goalIdx: index("snapshots_goal_idx").on(t.goalId),
}));

// ── notifications ─────────────────────────────────────────────────────────────
export const notifications = pgTable("notifications", {
  id:               uuid("id").primaryKey().defaultRandom(),
  goalId:           uuid("goal_id").notNull().references(() => goals.id),
  telegramChatId:   text("telegram_chat_id").notNull(),
  notificationType: text("notification_type").notNull(),
  messageText:      text("message_text").notNull(),
  sent:             boolean("sent").notNull().default(false),
  sentAt:           timestamp("sent_at"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  sentIdx: index("notifications_sent_idx").on(t.sent),
  goalIdx: index("notifications_goal_idx").on(t.goalId),
}));

// ── telegram_links ────────────────────────────────────────────────────────────
export const telegramLinks = pgTable("telegram_links", {
  id:            uuid("id").primaryKey().defaultRandom(),
  walletAddress: text("wallet_address").notNull().references(() => users.walletAddress),
  chatId:        text("chat_id"),
  code:          text("code").notNull().unique(),
  expiresAt:     timestamp("expires_at").notNull(),
  confirmedAt:   timestamp("confirmed_at"),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  walletIdx: index("telegram_links_wallet_idx").on(t.walletAddress),
  chatIdx:   index("telegram_links_chat_idx").on(t.chatId),
}));

// ── used_payments (x402 replay protection) ────────────────────────────────────
export const usedPayments = pgTable("used_payments", {
  txHash:       text("tx_hash").primaryKey(),
  payerAddress: text("payer_address").notNull(),
  amountUsdc:   numeric("amount_usdc", { precision: 12, scale: 6 }).notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
});
