const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function req<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GoalData {
  id:                  string;
  owner_wallet:        string;
  agent_wallet:        string;
  target_amount:       string;
  target_currency:     string;
  status:              "draft" | "active" | "action_required" | "paused" | "completed" | "cancelled" | "expired";
  deadline:            string;
  soft_paused:         boolean;
  progress_pct:        string | null;
  pace_status:         string | null;
  yield_earned:        string | null;
  principal_deposited: string | null;
  monthly_deposit:     string | null;
  strategy_json:       { expectedApyMin?: number; expectedApyMax?: number } | null;
  last_rebalanced_at:  string | null;
  action_reason:       string | null;
  goal_name:           string | null;
  created_at:          string;
  updated_at:          string;
}

export interface ExecutionEntry {
  id:          string;
  goal_id:     string;
  skill_name:  string;
  status:      string;
  tx_hash:     string | null;
  created_at:  string;
}

export interface GoalHistory {
  goals:      GoalData[];
  executions: ExecutionEntry[];
}

// ── API client ────────────────────────────────────────────────────────────────

export const api = {
  // Goals
  getGoalStatus: (wallet: string) =>
    req<GoalData | { status: "no_active_goal" }>(
      `/api/goals/status?wallet=${encodeURIComponent(wallet)}`
    ),

  getGoalHistory: (wallet: string) =>
    req<GoalHistory>(`/api/goals/history?wallet=${encodeURIComponent(wallet)}`),

  getAllGoals: (wallet: string) =>
    req<GoalData[]>(`/api/goals/all?wallet=${encodeURIComponent(wallet)}`),

  createGoal: (body: {
    ownerWallet:         string;
    agentWalletAddress:  string;
    targetAmount:        string;
    targetCurrency:      string;
    deadlineDate:        string;
    spendLimit?:         string;
    maxPerExecution?:    string;
    maxPerWeek?:         string;
    weeklyContribution?: string;
    contributionPattern?:"recurring" | "manual";
    goalName?:           string;
  }) =>
    req<{ goal: GoalData; strategy: unknown; approvalAmount: string }>(
      "/api/goals/create",
      { method: "POST", body: JSON.stringify(body) }
    ),

  activateGoal: (id: string) =>
    req<{ goalId: string; status: string }>(
      `/api/goals/${id}/activate`,
      { method: "POST", body: JSON.stringify({}) }
    ),

  pauseGoal: (id: string) =>
    req<{ goalId: string; status: string }>(
      `/api/goals/${id}/pause`,
      { method: "POST", body: JSON.stringify({}) }
    ),

  resumeGoal: (id: string) =>
    req<{ goalId: string; status: string }>(
      `/api/goals/${id}/resume`,
      { method: "POST", body: JSON.stringify({}) }
    ),

  withdrawGoal: (id: string, txHash?: string) =>
    req<{ goalId: string; status: string; execId: string }>(
      `/api/goals/${id}/withdraw`,
      { method: "POST", body: JSON.stringify({ txHash: txHash ?? null }) }
    ),

  reactivateGoal: (id: string) =>
    req<{ goalId: string; status: string }>(
      `/api/goals/${id}/reactivate`,
      { method: "POST", body: JSON.stringify({}) }
    ),

  getAgentStatus: (goalId: string) =>
    req<{
      latest: { status: string; reason: string | null; cycle_at: string } | null;
      recent: Array<{ status: string; reason: string | null; cycle_at: string }>;
    }>(`/api/goals/${goalId}/agent-status`),

  completeGoalAction: (id: string, action: "withdraw" | "continue" | "new_goal") =>
    req<{ goalId: string; action: string; execId?: string }>(
      `/api/goals/${id}/complete-action`,
      { method: "POST", body: JSON.stringify({ action }) }
    ),

  // Telegram
  requestTelegramLink: (wallet: string) =>
    req<{ code: string }>("/api/telegram/link", {
      method: "POST",
      body: JSON.stringify({ wallet }),
    }),

  // Chat usage
  getChatLimit: (wallet: string) =>
    req<{ used: number; freeLimit: number; remaining: number; isPaidTier: boolean }>(
      `/api/chat/limit?wallet=${encodeURIComponent(wallet)}`
    ),
};
