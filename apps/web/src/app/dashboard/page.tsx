"use client";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { api, type GoalData, type ExecutionEntry, type GoalHistory } from "@/lib/api";

const EXPLORER = process.env.NEXT_PUBLIC_APP_ENV === "prod"
  ? "https://celo.blockscout.com/tx/"
  : "https://celo-sepolia.blockscout.com/tx/";

const ALLOC = [
  { label: "USDT", pct: 60, apy: "8.89%", color: "#00D4A8" },
  { label: "USDC", pct: 30, apy: "2.61%", color: "#5B8DEF" },
  { label: "USDm", pct: 10, apy: "1.07%", color: "#7C6EF5" },
];

const SKILL_LABEL: Record<string, string> = {
  allocateSavings:    "allocate_savings",
  rebalancePortfolio: "rebalance_portfolio",
  checkGoalProgress:  "check_progress",
  executeMentoSwapAndSupply: "swap_and_supply",
  executeAaveSupply:  "aave_supply",
  withdrawAll:        "withdraw_all",
};

function StatusDot({ status }: { status: string }) {
  const color = status === "confirmed" ? "var(--green)" : status === "failed" ? "var(--red)" : "var(--amber)";
  return <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }} />;
}

export default function DashboardPage() {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const router  = useRouter();

  const [goal,        setGoal]        = useState<GoalData | null>(null);
  const [executions,  setExecutions]  = useState<ExecutionEntry[]>([]);
  const [agentStatus, setAgentStatus] = useState<{ status: string; reason: string | null; cycle_at: string } | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [pausing,     setPausing]     = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);

  // All API calls get a fresh token. getAccessToken() returns a cached JWT
  // and only fetches a new one when the current token is near expiry.
  async function getToken() {
    return getAccessToken();
  }

  async function fetchData(silent = false) {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const token = await getToken();
      const [gs, hist] = await Promise.all([
        api.getGoalStatus(token),
        api.getGoalHistory(token),
      ]);
      const g = (gs as { status?: string }).status === "no_active_goal" ? null : gs as GoalData;
      setGoal(g);
      setExecutions((hist as GoalHistory).executions ?? []);
      if (g?.id) {
        try {
          const ev = await api.getAgentStatus(token, g.id);
          setAgentStatus(ev?.latest ?? null);
        } catch {}
      }
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) { router.push("/"); return; }
    fetchData();
    const iv = setInterval(() => fetchData(true), 30_000);
    return () => clearInterval(iv);
  }, [ready, authenticated]);

  async function togglePause() {
    if (!goal) return;
    setPausing(true);
    try {
      const token = await getToken();
      if (goal.soft_paused) await api.resumeGoal(token, goal.id);
      else await api.pauseGoal(token, goal.id);
      setGoal(g => g ? { ...g, soft_paused: !g.soft_paused } : null);
    } catch {}
    finally { setPausing(false); }
  }

  const progress  = goal?.progress_pct ? parseFloat(goal.progress_pct) : 0;
  const targetAmt = goal ? Number(goal.target_amount) / 1e18 : 0;
  const currentAmt = targetAmt * (progress / 100);
  const yieldAmt  = goal?.yield_earned ? Number(goal.yield_earned) / 1e18 : 0;
  const daysLeft  = goal ? Math.max(0, Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / 86_400_000)) : 0;

  return (
    <AppShell>
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1>Dashboard</h1>
          {goal && !goal.soft_paused && goal.status === "active" && (
            <span className="badge badge-green"><span className="dot" />live</span>
          )}
          {goal?.soft_paused && <span className="badge badge-amber">paused</span>}
          {goal?.status === "action_required" && <span className="badge badge-red">action required</span>}
          {goal?.status === "expired" && <span className="badge badge-red">expired</span>}
          {goal?.status === "completed" && <span className="badge badge-blue">completed</span>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {refreshing && <span style={{ fontSize: 11, color: "var(--text3)", alignSelf: "center" }}>syncing…</span>}
          <button className="btn btn-ghost btn-sm" onClick={() => fetchData()}>↻</button>
          {goal && goal.status === "active" && (
            <>
              <button className="btn btn-secondary btn-sm" onClick={togglePause} disabled={pausing}>
                {pausing ? "…" : goal.soft_paused ? "▶ Resume" : "⏸ Pause"}
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => router.push("/withdraw")}>
                Withdraw
              </button>
            </>
          )}
          {goal?.status === "action_required" && (
            <button className="btn btn-secondary btn-sm" onClick={() => router.push("/reactivate")}>Fix now →</button>
          )}
          {goal?.status === "completed" && (
            <button className="btn btn-primary btn-sm" onClick={() => router.push("/goal-completed")}>Choose next step →</button>
          )}
        </div>
      </div>

      {loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, marginBottom: 1, background: "var(--border)", borderRadius: 8, overflow: "hidden" }}>
          {[0,1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 80 }} />)}
        </div>
      )}

      {!loading && !goal && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
          <div className="card" style={{ padding: "32px 28px" }}>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text3)", marginBottom: 10, letterSpacing: "0.06em" }}>
                NO ACTIVE GOAL
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>
                Start saving automatically
              </h2>
              <p style={{ color: "var(--text2)", fontSize: 13, lineHeight: 1.7 }}>
                Tell Penny your goal — she builds a DeFi strategy, manages it every 6 hours,
                and notifies you on milestones. Funds stay in your wallet.
              </p>
            </div>
            <button className="btn btn-primary" onClick={() => router.push("/enable")} style={{ width: "100%" }}>
              Set up a goal →
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { n: "01", t: "Set your goal",   d: "Name it, set a target and deadline. Penny figures out the strategy." },
              { n: "02", t: "Approve once",     d: "One ERC-20 signature. Penny operates within the exact spend limit you set — enforced on-chain." },
              { n: "03", t: "Sit back",         d: "Penny allocates, monitors every 6h, rebalances when APY drifts. You get Telegram pings." },
              { n: "04", t: "Withdraw anytime", d: "No lock-in. All funds returned as USDm whenever you want." },
            ].map(s => (
              <div key={s.n} className="card" style={{ padding: "16px" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text3)", width: 20, flexShrink: 0, paddingTop: 2 }}>{s.n}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>{s.t}</div>
                    <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>{s.d}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && goal && (
        <>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
            gap: 0, marginBottom: 16,
            border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden",
            background: "var(--border)",
          }}>
            {[
              { l: "Balance",     v: `$${currentAmt.toFixed(2)}`,         sub: `of $${targetAmt.toFixed(0)} goal` },
              { l: "Blended APY", v: `${goal.strategy_json?.expectedApyMin ?? 5.5}–${goal.strategy_json?.expectedApyMax ?? 7.0}%`, sub: "stable yield", green: true },
              { l: "Yield Earned", v: `+$${yieldAmt.toFixed(2)}`,         sub: "since activation", green: true },
              { l: "Days Left",   v: `${daysLeft}d`,                      sub: new Date(goal.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" }) },
            ].map((s) => (
              <div key={s.l} style={{ padding: "18px 20px", background: "var(--bg2)" }}>
                <div className="stat-label" style={{ marginBottom: 6 }}>{s.l}</div>
                <div className="stat-value" style={{ color: s.green ? "var(--green)" : "var(--text)", fontSize: 18 }}>{s.v}</div>
                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>{s.sub}</div>
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: "14px 16px", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>Guardian</span>
                {agentStatus ? (
                  <span className={`badge ${
                    agentStatus.status === "success"  ? "badge-green" :
                    agentStatus.status === "blocked"  ? "badge-red"   :
                    agentStatus.status === "paused"   ? "badge-red"   :
                    agentStatus.status === "skipped"  ? "badge-amber" : "badge-muted"
                  }`}>
                    {agentStatus.status === "success" ? "✓ all clear"  :
                     agentStatus.status === "blocked" ? "⚠ blocked"   :
                     agentStatus.status === "paused"  ? "⚠ paused"    :
                     agentStatus.status === "skipped" ? "skipped"      : agentStatus.status}
                  </span>
                ) : (
                  <span className="badge badge-muted">waiting for first cycle</span>
                )}
              </div>
              <div style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--text3)", display: "flex", gap: 12 }}>
                {agentStatus?.reason && (
                  <span style={{ color: agentStatus.status === "success" ? "var(--text3)" : "var(--amber)" }}>
                    {agentStatus.reason.replace(/_/g, " ")}
                  </span>
                )}
                {agentStatus?.cycle_at && (
                  <span>last cycle {new Date(agentStatus.cycle_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div className="card" style={{ padding: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                  <div className="stat-label" style={{ marginBottom: 4 }}>Goal progress</div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 26, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.02em" }}>
                    {progress.toFixed(1)}%
                  </div>
                </div>
                <div className={`badge ${goal.pace_status === "on_track" ? "badge-green" : "badge-amber"}`}>
                  {goal.pace_status === "on_track" ? "on track" : "behind"}
                </div>
              </div>
              <div className="progress-track" style={{ height: 4, marginBottom: 12 }}>
                <div className="progress-fill" style={{ width: `${Math.min(100, progress)}%` }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "var(--mono)", color: "var(--text3)" }}>
                <span>${currentAmt.toFixed(2)}</span>
                <span>${targetAmt.toFixed(2)}</span>
              </div>
            </div>

            <div className="card" style={{ padding: "20px" }}>
              <div className="stat-label" style={{ marginBottom: 14 }}>Strategy allocation</div>
              <div style={{ height: 4, display: "flex", gap: 2, marginBottom: 14, borderRadius: 2, overflow: "hidden" }}>
                {ALLOC.map(a => (
                  <div key={a.label} style={{ flex: a.pct, background: a.color }} />
                ))}
              </div>
              {ALLOC.map(a => (
                <div key={a.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, fontSize: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: a.color, display: "inline-block" }} />
                    <span style={{ fontFamily: "var(--mono)", color: "var(--text2)" }}>{a.label}</span>
                  </div>
                  <div style={{ display: "flex", gap: 12 }}>
                    <span style={{ fontFamily: "var(--mono)", color: "var(--text3)" }}>{a.apy}</span>
                    <span style={{ fontFamily: "var(--mono)", color: "var(--text)", fontWeight: 600 }}>{a.pct}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>Recent activity</div>
              <button className="btn btn-ghost btn-sm" onClick={() => router.push("/activity")}>View all →</button>
            </div>
            {executions.length === 0 ? (
              <div style={{ padding: "32px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
                No activity yet — Piggy will start soon.
              </div>
            ) : (
              <table className="table" style={{ width: "100%" }}>
                <thead>
                  <tr><th>Action</th><th>Time</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {executions.slice(0, 6).map(h => (
                    <tr key={h.id}>
                      <td><span style={{ fontFamily: "var(--mono)", color: "var(--text)", fontSize: 12 }}>{SKILL_LABEL[h.skill_name] ?? h.skill_name}</span></td>
                      <td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{new Date(h.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <StatusDot status={h.status} />
                          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text2)" }}>{h.status}</span>
                        </div>
                      </td>
                      <td>
                        {h.tx_hash && (
                          <a href={`${EXPLORER}${h.tx_hash}`} target="_blank" rel="noopener noreferrer"
                            style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--green)", textDecoration: "none" }}>
                            ↗ tx
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
