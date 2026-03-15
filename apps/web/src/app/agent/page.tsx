"use client";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { api, type GoalData } from "@/lib/api";

export default function AgentPage() {
  const { ready, authenticated, user } = usePrivy();
  const router  = useRouter();
  const address = user?.wallet?.address;

  const [goal,        setGoal]        = useState<GoalData | null>(null);
  const [agentStatus, setAgentStatus] = useState<{ status: string; reason: string | null; cycle_at: string } | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [pausing,     setPausing]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) { router.push("/"); return; }
    if (!address) return;
    const load = () => api.getGoalStatus(address).then(async g => {
      const gd = (g as { status?: string }).status === "no_active_goal" ? null : g as GoalData;
      setGoal(gd);
      if (gd?.id) {
        try { const ev = await api.getAgentStatus(gd.id); setAgentStatus(ev.latest); } catch {}
      }
    }).catch(e => setError((e as Error).message)).finally(() => setLoading(false));
    load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, [ready, authenticated, address]);

  async function togglePause() {
    if (!goal) return;
    setPausing(true);
    try {
      if (goal.soft_paused) await api.resumeGoal(goal.id);
      else await api.pauseGoal(goal.id);
      setGoal(g => g ? { ...g, soft_paused: !g.soft_paused } : null);
    } catch (e) { setError((e as Error).message); }
    finally { setPausing(false); }
  }

  const nextCycle = (() => {
    const now = new Date(); const next = new Date(now);
    next.setHours(Math.ceil((now.getHours() + 1) / 6) * 6, 0, 0, 0);
    const mins = Math.floor((next.getTime() - now.getTime()) / 60_000);
    const hrs  = Math.floor(mins / 60);
    return hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;
  })();

  const isRunning = goal && !goal.soft_paused && goal.status === "active";

  return (
    <AppShell>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
        <h1>Agent</h1>
        {isRunning && <span className="badge badge-green"><span className="dot" />running</span>}
        {goal?.soft_paused && <span className="badge badge-amber">paused</span>}
      </div>

      {error && (
        <div style={{ background: "var(--red-dim)", border: "1px solid #F0606030", borderRadius: 6, padding: "10px 14px", marginBottom: 16, fontSize: 12, fontFamily: "var(--mono)", color: "var(--red)" }}>
          {error}
        </div>
      )}

      {loading && <div className="skeleton" style={{ height: 200, borderRadius: 8 }} />}

      {!loading && !goal && (
        <div className="card" style={{ padding: "48px", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🐷</div>
          <p style={{ color: "var(--text2)", marginBottom: 20 }}>No active strategy. Enable Piggy to start.</p>
          <button className="btn btn-primary" onClick={() => router.push("/enable")}>Enable Piggy →</button>
        </div>
      )}

      {!loading && goal && (
        <div style={{ display: "grid", gap: 12, maxWidth: 600 }}>

          {/* Status */}
          <div className="card">
            <div style={{ padding: "16px 16px 0" }}>
              <div className="stat-label" style={{ marginBottom: 8 }}>Agent status</div>
            </div>
            {[
              { l: "State", v: goal.soft_paused ? "paused" : goal.status },
              { l: "Last cycle", v: agentStatus ? `${agentStatus.status}${agentStatus.reason ? ` · ${agentStatus.reason}` : ""}` : "—" },
              { l: "Cycle frequency", v: "every 6h" },
              { l: "Next cycle in", v: nextCycle },
            ].map(row => (
              <div className="card-row" key={row.l}>
                <span style={{ color: "var(--text3)", fontSize: 12 }}>{row.l}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text)" }}>{row.v}</span>
              </div>
            ))}
            <div style={{ padding: "12px 16px" }}>
              <button
                className={`btn ${goal.soft_paused ? "btn-primary" : "btn-secondary"} btn-sm`}
                onClick={togglePause} disabled={pausing}
              >
                {pausing ? "…" : goal.soft_paused ? "▶ Resume agent" : "⏸ Pause agent"}
              </button>
            </div>
          </div>

          {/* Guardrails */}
          <div className="card">
            <div style={{ padding: "16px 16px 0" }}>
              <div className="stat-label" style={{ marginBottom: 8 }}>Guardrails active</div>
            </div>
            {[
              { l: "Circuit breaker",     v: "peg · risk · volatility" },
              { l: "Spend limit",         v: "enforced on-chain" },
              { l: "Rebalance frequency", v: "max 1× per 24h" },
              { l: "Slippage guard",      v: "max 1%" },
              { l: "Non-custodial",       v: "funds in your wallet" },
            ].map(row => (
              <div className="card-row" key={row.l}>
                <span style={{ color: "var(--text3)", fontSize: 12 }}>{row.l}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)", display: "inline-block" }} />
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text2)" }}>{row.v}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Danger zone */}
          <div className="card" style={{ borderColor: "#F0606030" }}>
            <div className="card-row" style={{ borderBottom: "none" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", marginBottom: 3 }}>Withdraw & exit</div>
                <div style={{ fontSize: 12, color: "var(--text3)" }}>Close all positions. Funds return as USDm.</div>
              </div>
              <button className="btn btn-danger btn-sm" onClick={() => router.push("/withdraw")}>
                Withdraw →
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
