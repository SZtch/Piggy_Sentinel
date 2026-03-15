const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// ── Authenticated request helper ─────────────────────────────────────────────
// All API calls that touch user data require a Privy Bearer token.
// Pass the token from usePrivy().getAccessToken() into api methods.
//
// Usage in a page component:
//   const { getAccessToken } = usePrivy();
//   const token = await getAccessToken();
//   const goal = await api.getGoalStatus(token);

async function req<T = unknown>(
  path:    string,
  token:   string | null,
  options?: RequestInit,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API}${path}`, {
    headers,
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
// Every method that reads or writes user data takes `token` as its first arg.
// The token is a Privy access token — get it with `await getAccessToken()`
// from the usePrivy() hook.
//
// The server ignores any wallet address in the request body or query string —
// it uses the wallet address from the verified token only.

export const api = {
  // Goals — all require auth token
  getGoalStatus: (token: string | null) =>
    req<GoalData | { status: "no_active_goal" }>(
      "/api/goals/status",
      token,
    ),

  getGoalHistory: (token: string | null) =>
    req<GoalHistory>("/api/goals/history", token),

  getAllGoals: (token: string | null) =>
    req<GoalData[]>("/api/goals/all", token),

  createGoal: (token: string | null, body: {
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
    // ownerWallet is NOT included — the server derives it from your token
  }) =>
    req<{ goal: GoalData; strategy: unknown; approvalAmount: string }>(
      "/api/goals/create",
      token,
      { method: "POST", body: JSON.stringify(body) },
    ),

  activateGoal: (token: string | null, id: string) =>
    req<{ goalId: string; status: string }>(
      `/api/goals/${id}/activate`,
      token,
      { method: "POST", body: JSON.stringify({}) },
    ),

  pauseGoal: (token: string | null, id: string) =>
    req<{ goalId: string; status: string }>(
      `/api/goals/${id}/pause`,
      token,
      { method: "POST", body: JSON.stringify({}) },
    ),

  resumeGoal: (token: string | null, id: string) =>
    req<{ goalId: string; status: string }>(
      `/api/goals/${id}/resume`,
      token,
      { method: "POST", body: JSON.stringify({}) },
    ),

  withdrawGoal: (token: string | null, id: string, txHash?: string) =>
    req<{ goalId: string; status: string; execId: string }>(
      `/api/goals/${id}/withdraw`,
      token,
      { method: "POST", body: JSON.stringify({ txHash: txHash ?? null }) },
    ),

  reactivateGoal: (token: string | null, id: string) =>
    req<{ goalId: string; status: string }>(
      `/api/goals/${id}/reactivate`,
      token,
      { method: "POST", body: JSON.stringify({}) },
    ),

  getAgentStatus: (token: string | null, goalId: string) =>
    req<{
      latest: { status: string; reason: string | null; cycle_at: string } | null;
      recent: Array<{ status: string; reason: string | null; cycle_at: string }>;
    }>(`/api/goals/${goalId}/agent-status`, token),

  completeGoalAction: (token: string | null, id: string, action: "withdraw" | "continue" | "new_goal") =>
    req<{ goalId: string; action: string; execId?: string }>(
      `/api/goals/${id}/complete-action`,
      token,
      { method: "POST", body: JSON.stringify({ action }) },
    ),

  // Telegram (no auth needed — public link flow)
  requestTelegramLink: (wallet: string) =>
    req<{ code: string; expiresAt: string }>("/api/telegram/request-link", null, {
      method: "POST",
      body: JSON.stringify({ walletAddress: wallet }),
    }),

  // Chat — uses x-payment header, not Bearer token
  getChatLimit: (token: string | null) =>
    req<{ used: number; freeLimit: number; remaining: number; isPaidTier: boolean }>(
      "/api/chat/limit",
      token,
    ),
};
