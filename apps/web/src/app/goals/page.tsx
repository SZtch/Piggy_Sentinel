"use client";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { api, type GoalData } from "@/lib/api";

const STATUS_META: Record<string, { label: string; badge: string; icon: string }> = {
  active:    { label: "Active",    badge: "badge-green",   icon: "▶" },
  paused:    { label: "Paused",    badge: "badge-amber",   icon: "⏸" },
  completed: { label: "Completed", badge: "badge-blue",    icon: "✓" },
  cancelled: { label: "Cancelled", badge: "badge-neutral", icon: "✕" },
  draft:     { label: "Draft",     badge: "badge-neutral", icon: "○" },
};

export default function GoalsPage() {
  const { ready, authenticated, user } = usePrivy();
  const router  = useRouter();
  const address = user?.wallet?.address;
  const [goals,   setGoals]   = useState<GoalData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) { router.push("/"); return; }
    if (!address) return;
    api.getAllGoals(address)
      .then(gs => setGoals(gs as GoalData[]))
      .catch(e  => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [ready, authenticated, address]);

  async function handleResume(id: string) {
    try {
      await api.resumeGoal(id);
      setGoals(gs => gs.map(g => g.id === id ? { ...g, status: "active", soft_paused: false } : g));
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <AppShell>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 26, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 className="font-display" style={{ fontSize: 21, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.03em" }}>My Goals</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 12.5, marginTop: 2 }}>
            {loading ? "Loading…" : `${goals.length} goal${goals.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => router.push("/enable")}>
          + New goal
        </button>
      </div>

      {error && (
        <div style={{ background: "var(--red-light)", color: "var(--red)", borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 20, fontSize: 13 }}>⚠ {error}</div>
      )}

      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[0,1].map(i => <div key={i} className="card skeleton" style={{ height: 110 }} />)}
        </div>
      )}

      {!loading && goals.length === 0 && (
        <div className="card animate-scale-in" style={{ padding: "60px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 14 }}>🐷</div>
          <h2 className="font-display" style={{ fontSize: 19, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>No goals yet</h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: 24, fontSize: 14 }}>Create a savings goal and let Piggy do the work.</p>
          <button className="btn btn-primary" onClick={() => router.push("/enable")}>Enable Piggy →</button>
        </div>
      )}

      {!loading && goals.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {goals.map(goal => {
            const progress  = goal.progress_pct ? parseFloat(goal.progress_pct) : 0;
            const targetAmt = Number(goal.target_amount) / 1e18;
            const current   = targetAmt * (progress / 100);
            const daysLeft  = Math.max(0, Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / 86_400_000));
            const meta      = STATUS_META[goal.status] ?? STATUS_META["draft"];

            return (
              <div key={goal.id} className="card" style={{ padding: "20px 22px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                  <div>
                    <div className="font-display" style={{ fontWeight: 600, fontSize: 16, color: "var(--text-primary)", marginBottom: 3 }}>
                      {(goal as GoalData & { goal_name?: string }).goal_name ?? "Savings Goal"}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                      {goal.target_currency} · {daysLeft > 0 ? `${daysLeft} days left` : "Past deadline"} · {new Date(goal.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </div>
                  </div>
                  <div className={`badge ${meta.badge}`}>{meta.icon} {meta.label}</div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-tertiary)", marginBottom: 6 }}>
                    <span>${current.toFixed(2)} saved</span>
                    <span>${targetAmt.toFixed(2)} target · {progress.toFixed(1)}%</span>
                  </div>
                  <div className="progress-track" style={{ height: 6 }}>
                    <div className="progress-fill" style={{ width: `${Math.min(100, progress)}%` }} />
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                    APY: {goal.strategy_json?.expectedApyMin ?? 5.5}–{goal.strategy_json?.expectedApyMax ?? 7.0}%
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {goal.status === "paused" && (
                      <button className="btn btn-secondary btn-sm" onClick={() => handleResume(goal.id)}>▶ Resume</button>
                    )}
                    {goal.status === "active" && (
                      <button className="btn btn-sm" onClick={() => router.push("/withdraw")}
                        style={{ background: "var(--red-light)", color: "var(--red)", border: "1px solid #fca5a5", borderRadius: "var(--radius-full)", cursor: "pointer" }}>
                        Withdraw
                      </button>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => router.push("/dashboard")}>View →</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
