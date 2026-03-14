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
    api.getGoalStatus(address)
      .then(async g => {
        const gd = (g as { status?: string }).status === "no_active_goal" ? null : g as GoalData;
        setGoal(gd);
        if (gd?.id) {
          try {
            const ev = await api.getAgentStatus(gd.id);
            setAgentStatus(ev.latest);
          } catch { /* agent status is optional */ }
        }
      })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [ready, authenticated, address]);

  async function togglePause() {
    if (!goal) return;
    setPausing(true);
    try {
      if (goal.soft_paused) await api.resumeGoal(goal.id);
      else                  await api.pauseGoal(goal.id);
      setGoal(g => g ? { ...g, soft_paused: !g.soft_paused, status: g.soft_paused ? "active" : "paused" } : null);
    } catch (e) { setError((e as Error).message); }
    finally { setPausing(false); }
  }

  const nextCycle = (() => {
    const now  = new Date();
    const next = new Date(now);
    next.setHours(Math.ceil((now.getHours() + 1) / 6) * 6, 0, 0, 0);
    const mins = Math.floor((next.getTime() - now.getTime()) / 60_000);
    const hrs  = Math.floor(mins / 60);
    return hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;
  })();

  return (
    <AppShell>
      <div style={{ maxWidth: 560 }}>
        <div style={{ marginBottom: 28 }}>
          <h1 className="font-display" style={{ fontSize: 21, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.03em" }}>Agent Control</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 12.5, marginTop: 2 }}>Manage how Piggy operates on your behalf.</p>
        </div>

        {error && <div style={{ background: "var(--red-light)", color: "var(--red)", borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 20, fontSize: 13 }}>⚠ {error}</div>}
        {loading && <div className="card skeleton" style={{ height: 180 }} />}

        {!loading && !goal && (
          <div className="card" style={{ padding: "48px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🐷</div>
            <p style={{ color: "var(--text-secondary)", marginBottom: 20, fontSize: 14 }}>No active strategy. Enable Piggy to get started.</p>
            <button className="btn btn-primary" onClick={() => router.push("/enable")}>Enable Piggy →</button>
          </div>
        )}

        {!loading && goal && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Status card */}
            <div className="card" style={{ padding: "22px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <div className="stat-label" style={{ marginBottom: 4 }}>Agent status</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {goal.status === "active" && !goal.soft_paused && <span className="live-dot" />}
                    <span className="font-display" style={{ fontSize: 18, fontWeight: 700, color:
                      goal.status === "action_required" ? "var(--amber)" :
                      goal.status === "completed"       ? "var(--accent)" :
                      goal.status === "expired"         ? "var(--red)" :
                      goal.soft_paused                  ? "var(--amber)" : "var(--accent)" }}>
                      {goal.status === "action_required" ? "Action Required" :
                       goal.status === "completed"       ? "Completed" :
                       goal.status === "expired"         ? "Expired" :
                       goal.soft_paused                  ? "Paused" : "Running"}
                    </span>
                    {agentStatus && (
                      <span style={{ fontSize: 11, color: "var(--text-tertiary)", fontWeight: 400 }}>
                        · last cycle: {agentStatus.status}
                        {agentStatus.reason ? ` (${agentStatus.reason})` : ""}
                      </span>
                    )}
                  </div>
                </div>
                <button className={`btn ${goal.soft_paused ? "btn-primary" : "btn-secondary"}`} onClick={togglePause} disabled={pausing}>
                  {pausing ? "…" : goal.soft_paused ? "▶ Resume Piggy" : "⏸ Pause Piggy"}
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0 }}>
                {[
                  { l: "Cycle frequency", v: "Every 6 hours" },
                  { l: "Next cycle",      v: nextCycle },
                  { l: "Goal status",     v: goal.status.charAt(0).toUpperCase() + goal.status.slice(1) },
                ].map((s, i) => (
                  <div key={s.l} style={{ borderRight: i < 2 ? "1px solid var(--border-subtle)" : "none", paddingRight: i < 2 ? 14 : 0, paddingLeft: i > 0 ? 14 : 0 }}>
                    <div className="stat-label" style={{ marginBottom: 3 }}>{s.l}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{s.v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Spending limits */}
            <div className="card" style={{ padding: "22px" }}>
              <div className="font-display" style={{ fontWeight: 600, fontSize: 14.5, marginBottom: 16, color: "var(--text-primary)" }}>🛡️ Spending limits</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {[
                  { label: "Max per execution", icon: "⚡", desc: "Enforced on-chain" },
                  { label: "Max per week",       icon: "📅", desc: "Enforced on-chain" },
                ].map(s => (
                  <div key={s.label} className="card-inset" style={{ padding: "14px", borderRadius: "var(--radius-md)" }}>
                    <div style={{ fontSize: 16, marginBottom: 8 }}>{s.icon}</div>
                    <div className="stat-label" style={{ marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{s.desc}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 14, lineHeight: 1.55 }}>
                Limits are set during "Grant Permission" and enforced by the SentinelExecutor contract. To change them, revoke and re-enable Piggy.
              </div>
            </div>

            {/* Capabilities */}
            <div className="card" style={{ padding: "22px" }}>
              <div className="font-display" style={{ fontWeight: 600, fontSize: 14.5, marginBottom: 16, color: "var(--text-primary)" }}>⚙️ What Piggy can do</div>
              {[
                { icon: "💰", label: "Allocate savings",    desc: "Move funds into yield strategies per your plan" },
                { icon: "⚖️", label: "Rebalance portfolio", desc: "Adjust allocation when market conditions change" },
                { icon: "📊", label: "Track progress",      desc: "Monitor goal progress every cycle" },
                { icon: "💱", label: "Currency hedging",    desc: "Manage FX exposure via Mento when enabled" },
              ].map((item, i) => (
                <div key={item.label} style={{ display: "flex", gap: 12, marginBottom: i < 3 ? 14 : 0, alignItems: "flex-start" }}>
                  <div style={{ width: 32, height: 32, borderRadius: "var(--radius-sm)", background: "var(--accent-pale)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{item.icon}</div>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-primary)" }}>{item.label}</div>
                    <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 1 }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Withdraw zone */}
            <div className="card" style={{ padding: "18px 22px", border: "1.5px solid var(--red-light)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 3 }}>Withdraw & stop Piggy</div>
                  <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Close all positions and return funds to your wallet.</div>
                </div>
                <button onClick={() => router.push("/withdraw")}
                  style={{ background: "var(--red)", color: "#fff", borderRadius: "var(--radius-full)", padding: "9px 18px", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", flexShrink: 0 }}>
                  Withdraw
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
