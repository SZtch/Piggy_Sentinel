"use client";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { api, type GoalData, type ExecutionEntry, type GoalHistory } from "@/lib/api";

const ALLOC = [
  { label: "USDT", protocol: "Aave", pct: 60, color: "#0A6B4B" },
  { label: "USDC", protocol: "Aave", pct: 30, color: "#0D8A60" },
  { label: "USDm", protocol: "Aave", pct: 10, color: "#18C77A" },
];
const SKILL_ICONS: Record<string, string> = {
  allocateSavings:    "💰",
  rebalancePortfolio: "⚖️",
  checkGoalProgress:  "📊",
  checkFxDrift:       "💱",
  hedgeFxExposure:    "🛡️",
  withdrawAll:        "📤",
};

function ProgressRing({ pct, size = 130 }: { pct: number; size?: number }) {
  const r = (size / 2) - 10;
  const circ = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--bg-secondary)" strokeWidth={9} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--accent)" strokeWidth={9}
          strokeLinecap="round" strokeDasharray={circ}
          strokeDashoffset={circ - (pct / 100) * circ}
          style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.22,1,0.36,1)" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div className="font-display" style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.03em", lineHeight: 1 }}>{pct.toFixed(1)}%</div>
        <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 2 }}>progress</div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub, accent }: { icon: string; label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="card" style={{ padding: "18px 20px" }}>
      <div style={{ fontSize: 16, marginBottom: 8 }}>{icon}</div>
      <div className="stat-label" style={{ marginBottom: 5 }}>{label}</div>
      <div className="font-display" style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.03em", color: accent ? "var(--accent)" : "var(--text-primary)", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const { ready, authenticated, user } = usePrivy();
  const router  = useRouter();
  const address = user?.wallet?.address;

  const [goal,        setGoal]        = useState<GoalData | null>(null);
  const [executions,  setExecutions]  = useState<ExecutionEntry[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [pausing,     setPausing]     = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing,  setRefreshing]  = useState(false);

  async function fetchData(addr: string, silent = false) {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const [gs, hist] = await Promise.all([
        api.getGoalStatus(addr),
        api.getGoalHistory(addr),
      ]);
      const g = (gs as { status?: string }).status === "no_active_goal" ? null : gs as GoalData;
      setGoal(g);
      setExecutions((hist as GoalHistory).executions ?? []);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      if (!silent) setError((err as Error).message);
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) { router.push("/"); return; }
    if (!address) return;
    fetchData(address);
    const iv = setInterval(() => fetchData(address, true), 30_000);
    return () => clearInterval(iv);
  }, [ready, authenticated, address]);

  async function togglePause() {
    if (!goal) return;
    setPausing(true);
    try {
      if (goal.soft_paused) await api.resumeGoal(goal.id);
      else                  await api.pauseGoal(goal.id);
      setGoal(g => g ? { ...g, soft_paused: !g.soft_paused, status: g.soft_paused ? "active" : "paused" } : null);
    } catch (err) { setError(err instanceof Error ? err.message : "Action failed"); }
    finally { setPausing(false); }
  }

  const progress   = goal?.progress_pct ? parseFloat(goal.progress_pct) : 0;
  const targetAmt  = goal ? Number(goal.target_amount) / 1e18 : 0;
  const currentAmt = targetAmt * (progress / 100);
  const yieldAmt   = goal?.yield_earned ? Number(goal.yield_earned) / 1e18 : 0;
  const apyMin     = goal?.strategy_json?.expectedApyMin ?? 5.5;
  const apyMax     = goal?.strategy_json?.expectedApyMax ?? 7.0;
  const daysLeft   = goal ? Math.max(0, Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / 86_400_000)) : 0;

  const EXPLORER = process.env.NEXT_PUBLIC_APP_ENV === "prod"
    ? "https://celo.blockscout.com/tx/" : "https://celo-sepolia.blockscout.com/tx/";

  return (
    <AppShell>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 26, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 className="font-display" style={{ fontSize: 21, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.03em" }}>Dashboard</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 12.5, marginTop: 2, display: "flex", alignItems: "center", gap: 5 }}>
            {loading ? "Loading…" : goal ? <><span className="live-dot" /> Piggy is managing your savings</> : "No active strategy yet."}
            {lastUpdated && !loading && (
              <span style={{ color: "var(--text-tertiary)", marginLeft: 4 }}>
                {refreshing ? <span style={{ color: "var(--accent)" }}>↻ updating</span> : <>· {lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</>}
              </span>
            )}
          </p>
        </div>

        {!loading && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-ghost btn-sm" onClick={() => address && fetchData(address)} disabled={loading || refreshing} style={{ fontSize: 14 }} title="Refresh">↻</button>
            {goal ? (
              <>
                {goal.status === "completed" && (
                  <button className="btn btn-primary btn-sm" onClick={() => router.push("/goal-completed")}>
                    🎉 Goal complete — choose next step
                  </button>
                )}
                {goal.status === "action_required" && (
                  <button className="btn btn-sm" onClick={() => router.push("/reactivate")}
                    style={{ background: "var(--amber-light)", color: "var(--amber)", border: "1px solid var(--amber)", borderRadius: "var(--radius-full)", cursor: "pointer" }}>
                    ⚠ Action required
                  </button>
                )}
                {goal.status === "expired" && (
                  <button className="btn btn-sm" onClick={() => router.push("/withdraw")}
                    style={{ background: "var(--red-light)", color: "var(--red)", border: "1px solid #fca5a5", borderRadius: "var(--radius-full)", cursor: "pointer" }}>
                    Goal expired — withdraw
                  </button>
                )}
                {["active", "paused", "action_required"].includes(goal.status) && goal.status !== "completed" && goal.status !== "expired" && (
                  <>
                    {goal.status !== "action_required" && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={togglePause}
                        disabled={pausing}
                        style={{ borderColor: goal.soft_paused ? "var(--accent)" : undefined, color: goal.soft_paused ? "var(--accent)" : undefined }}
                      >
                        {pausing ? "…" : goal.soft_paused ? "▶ Resume" : "⏸ Pause"}
                      </button>
                    )}
                    <button
                      className="btn btn-sm"
                      onClick={() => router.push("/withdraw")}
                      style={{ background: "var(--red-light)", color: "var(--red)", border: "1px solid #fca5a5", borderRadius: "var(--radius-full)", cursor: "pointer" }}
                    >
                      Withdraw
                    </button>
                  </>
                )}
              </>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={() => router.push("/enable")}>Enable Piggy →</button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div style={{ background: "var(--red-light)", color: "var(--red)", borderRadius: "var(--radius-md)", padding: "11px 16px", marginBottom: 20, fontSize: 13, display: "flex", gap: 10, alignItems: "center" }}>
          ⚠ {error} <button onClick={() => setError(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--red)", cursor: "pointer" }}>✕</button>
        </div>
      )}

      {/* Skeletons */}
      {loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginBottom: 16 }}>
          {[0,1,2,3].map(i => <div key={i} className="card skeleton" style={{ height: 100 }} />)}
        </div>
      )}

      {/* Empty state */}
      {!loading && !goal && (
        <div className="card animate-scale-in" style={{ padding: "64px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 50, marginBottom: 14 }}>🐷</div>
          <h2 className="font-display" style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8, letterSpacing: "-0.02em" }}>No active strategy</h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: 24, fontSize: 14, maxWidth: 300, margin: "0 auto 24px" }}>
            Tell Piggy what you're saving for — she handles the rest automatically.
          </p>
          <button className="btn btn-primary" onClick={() => router.push("/enable")}>Enable Piggy →</button>
        </div>
      )}

      {!loading && goal && (
        <>
          {/* Action required banner */}
          {goal.status === "action_required" && (
            <div style={{ background: "var(--amber-light)", border: "1.5px solid var(--amber)", borderRadius: "var(--radius-lg)", padding: "16px 20px", marginBottom: 16, display: "flex", gap: 14, alignItems: "center" }}>
              <span style={{ fontSize: 22 }}>⚠️</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: "var(--amber)", marginBottom: 3 }}>Action required — Piggy is paused</div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  {goal.action_reason === "allowance_revoked"
                    ? "Spending permission was revoked. Re-approve in the app to resume."
                    : goal.action_reason === "balance_insufficient"
                    ? "Wallet balance too low. Top up with USDm to continue."
                    : "Please review your goal settings to resume automation."}
                </div>
              </div>
              <button className="btn btn-sm"
                onClick={() => router.push("/reactivate")}
                style={{ background: "var(--amber)", color: "#fff", border: "none", borderRadius: "var(--radius-full)", cursor: "pointer", flexShrink: 0 }}>
                Fix now →
              </button>
            </div>
          )}

          {/* Completed banner */}
          {goal.status === "completed" && (
            <div style={{ background: "var(--accent-pale)", border: "1.5px solid var(--accent-light)", borderRadius: "var(--radius-lg)", padding: "16px 20px", marginBottom: 16, display: "flex", gap: 14, alignItems: "center" }}>
              <span style={{ fontSize: 22 }}>🎉</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: "var(--accent)", marginBottom: 3 }}>Goal reached!</div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Your savings target is complete. Choose what to do next.</div>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => router.push("/goal-completed")}>Choose →</button>
            </div>
          )}

          {/* Expired banner */}
          {goal.status === "expired" && (
            <div style={{ background: "var(--red-light)", border: "1.5px solid #fca5a5", borderRadius: "var(--radius-lg)", padding: "16px 20px", marginBottom: 16, display: "flex", gap: 14, alignItems: "center" }}>
              <span style={{ fontSize: 22 }}>⏰</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: "var(--red)", marginBottom: 3 }}>Goal expired</div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>The deadline passed. Withdraw your funds or start a new goal.</div>
              </div>
              <button className="btn btn-sm"
                onClick={() => router.push("/withdraw")}
                style={{ background: "var(--red)", color: "#fff", border: "none", borderRadius: "var(--radius-full)", cursor: "pointer", flexShrink: 0 }}>
                Withdraw →
              </button>
            </div>
          )}

          {/* Stats grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px,1fr))", gap: 12, marginBottom: 16 }}>
            <StatCard icon="💰" label="Total Balance"
              value={`$${currentAmt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              sub={`of $${targetAmt.toLocaleString()} target`} />
            <StatCard icon="📈" label="Blended APY"
              value={`${apyMin.toFixed(1)}–${apyMax.toFixed(1)}%`}
              sub="Stable yield" accent />
            <StatCard icon="✨" label="Yield Earned"
              value={`+$${yieldAmt.toFixed(2)}`}
              sub="Since activation" accent />
            <StatCard icon="📅" label="Days Left"
              value={`${daysLeft}`}
              sub={new Date(goal.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} />
          </div>

          {/* Progress + Allocation */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>

            {/* Progress card */}
            <div className="card animate-fade-up" style={{ padding: "24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div>
                  <div className="stat-label" style={{ marginBottom: 3 }}>Goal Progress</div>
                  <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                    ${currentAmt.toFixed(2)} <span style={{ color: "var(--text-tertiary)" }}>/ ${targetAmt.toFixed(2)}</span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
                  <div className={`badge ${goal.soft_paused ? "badge-amber" : goal.pace_status === "on_track" ? "badge-green" : "badge-amber"}`}>
                    {goal.soft_paused ? "⏸ Paused" : goal.pace_status === "on_track" ? "✓ On Track" : "⚠ Behind"}
                  </div>
                  <div style={{ fontSize: 11, color: goal.soft_paused ? "var(--text-tertiary)" : "var(--accent)", display: "flex", alignItems: "center", gap: 4 }}>
                    {!goal.soft_paused && <span className="live-dot" style={{ width: 5, height: 5 }} />}
                    {goal.soft_paused ? "Paused" : "Piggy active"}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                <ProgressRing pct={progress} />
                <div style={{ flex: 1 }}>
                  <div className="progress-track" style={{ height: 6, marginBottom: 16 }}>
                    <div className="progress-fill" style={{ width: `${Math.min(100, progress)}%` }} />
                  </div>
                  {[25, 50, 75, 100].map(m => (
                    <div key={m} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 6 }}>
                      <div style={{ width: 16, height: 16, borderRadius: "50%", background: progress >= m ? "var(--accent)" : "var(--bg-secondary)", border: `1.5px solid ${progress >= m ? "var(--accent)" : "var(--border)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {progress >= m && <svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1.5 4L3.5 6L6.5 2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/></svg>}
                      </div>
                      <span style={{ color: progress >= m ? "var(--text-primary)" : "var(--text-tertiary)", fontWeight: progress >= m ? 500 : 400 }}>{m}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Allocation card */}
            <div className="card animate-fade-up delay-100" style={{ padding: "24px" }}>
              <div className="stat-label" style={{ marginBottom: 16 }}>Strategy allocation</div>

              <div style={{ height: 8, borderRadius: "var(--radius-full)", overflow: "hidden", display: "flex", gap: 1.5, marginBottom: 18 }}>
                {ALLOC.map(a => <div key={a.label} style={{ flex: a.pct, background: a.color }} />)}
              </div>

              {ALLOC.map((a, i) => (
                <div key={a.label} style={{ marginBottom: i < ALLOC.length - 1 ? 12 : 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: a.color }} />
                      <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                        {a.label} <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>via {a.protocol}</span>
                      </span>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{a.pct}%</span>
                  </div>
                  <div style={{ height: 4, background: "var(--bg-secondary)", borderRadius: "var(--radius-full)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${a.pct}%`, background: a.color, borderRadius: "var(--radius-full)", transition: "width 0.7s cubic-bezier(0.22,1,0.36,1)" }} />
                  </div>
                </div>
              ))}

              <div style={{ marginTop: 18, padding: "11px 14px", background: "var(--accent-pale)", borderRadius: "var(--radius-md)", border: "1px solid var(--accent-light)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--accent)", fontWeight: 500 }}>Blended APY estimate</span>
                <span className="font-display" style={{ fontWeight: 700, color: "var(--accent)", fontSize: 17 }}>~6.22%</span>
              </div>
            </div>
          </div>

          {/* Activity feed */}
          <div className="card animate-fade-up delay-200">
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div className="font-display" style={{ fontWeight: 600, fontSize: 14.5, color: "var(--text-primary)" }}>Recent activity</div>
                <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 2 }}>Automated actions by Piggy</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => router.push("/activity")} style={{ fontSize: 12 }}>View all →</button>
            </div>

            {executions.length === 0 ? (
              <div style={{ padding: "40px 20px", textAlign: "center" }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>🐷</div>
                <div style={{ color: "var(--text-tertiary)", fontSize: 13.5 }}>No activity yet — Piggy will start soon.</div>
              </div>
            ) : (
              executions.slice(0, 5).map((h, i) => (
                <div key={h.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 20px", borderBottom: i < Math.min(executions.length, 5) - 1 ? "1px solid var(--border-subtle)" : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: h.status === "confirmed" ? "var(--accent-pale)" : h.status === "failed" ? "var(--red-light)" : "var(--amber-light)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, border: `1px solid ${h.status === "confirmed" ? "var(--accent-light)" : h.status === "failed" ? "var(--red-light)" : "var(--amber-light)"}` }}>
                      {SKILL_ICONS[h.skill_name] ?? (h.status === "confirmed" ? "✓" : h.status === "failed" ? "✕" : "⏳")}
                    </div>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-primary)" }}>
                        {h.skill_name.replace(/([A-Z])/g, " $1").trim()}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 1 }}>
                        {new Date(h.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div className={`badge ${h.status === "confirmed" ? "badge-green" : h.status === "failed" ? "badge-red" : "badge-amber"}`}>{h.status}</div>
                    {h.tx_hash && (
                      <a href={`${EXPLORER}${h.tx_hash}`} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 11, color: "var(--accent)", background: "var(--accent-pale)", border: "1px solid var(--accent-light)", padding: "3px 8px", borderRadius: "var(--radius-full)", textDecoration: "none" }}>
                        ↗ Tx
                      </a>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
