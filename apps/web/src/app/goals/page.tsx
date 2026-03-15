"use client";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { api, type GoalData } from "@/lib/api";

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
    const load = () => api.getAllGoals(address)
      .then(gs => setGoals(gs as GoalData[]))
      .catch(e  => setError((e as Error).message))
      .finally(() => setLoading(false));
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, [ready, authenticated, address]);

  const statusBadge = (status: string, paused?: boolean) => {
    if (paused) return <span className="badge badge-amber">paused</span>;
    if (status === "active")           return <span className="badge badge-green">active</span>;
    if (status === "completed")        return <span className="badge badge-blue">completed</span>;
    if (status === "action_required")  return <span className="badge badge-red">action needed</span>;
    if (status === "expired")          return <span className="badge badge-red">expired</span>;
    return <span className="badge badge-muted">{status}</span>;
  };

  return (
    <AppShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1>Goals</h1>
          {!loading && (
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text3)" }}>
              {goals.length} total
            </span>
          )}
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => router.push("/enable")}>
          + New goal
        </button>
      </div>

      {error && (
        <div style={{ background: "var(--red-dim)", border: "1px solid #F0606030", borderRadius: 6, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "var(--red)", fontFamily: "var(--mono)" }}>
          {error}
        </div>
      )}

      {loading && (
        <div className="card">
          {[0,1,2].map(i => <div key={i} className="skeleton" style={{ height: 56, margin: "1px 0" }} />)}
        </div>
      )}

      {!loading && goals.length === 0 && (
        <div className="card" style={{ padding: "48px", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🐷</div>
          <p style={{ color: "var(--text2)", marginBottom: 20 }}>No goals yet. Create one to start saving.</p>
          <button className="btn btn-primary" onClick={() => router.push("/enable")}>Create goal →</button>
        </div>
      )}

      {!loading && goals.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Goal</th>
                <th>Progress</th>
                <th>Target</th>
                <th>Deadline</th>
                <th>APY</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {goals.map(goal => {
                const progress  = goal.progress_pct ? parseFloat(goal.progress_pct) : 0;
                const targetAmt = Number(goal.target_amount) / 1e18;
                const current   = targetAmt * (progress / 100);
                const daysLeft  = Math.max(0, Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / 86_400_000));

                return (
                  <tr key={goal.id}>
                    <td>
                      <span style={{ color: "var(--text)", fontWeight: 500 }}>
                        {(goal as any).goal_name ?? "Savings Goal"}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="progress-track" style={{ width: 60 }}>
                          <div className="progress-fill" style={{ width: `${Math.min(100, progress)}%` }} />
                        </div>
                        <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text2)" }}>
                          {progress.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                      ${current.toFixed(0)} / ${targetAmt.toFixed(0)}
                    </td>
                    <td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                      {daysLeft > 0 ? `${daysLeft}d` : "expired"}
                    </td>
                    <td style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--green)" }}>
                      ~{goal.strategy_json?.expectedApyMin ?? 5.5}%
                    </td>
                    <td>{statusBadge(goal.status, goal.soft_paused)}</td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => router.push("/dashboard")}>
                        View →
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
