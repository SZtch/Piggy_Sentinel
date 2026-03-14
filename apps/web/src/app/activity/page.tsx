"use client";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { api, type ExecutionEntry, type GoalHistory } from "@/lib/api";

const SKILL_ICONS: Record<string, string> = {
  allocateSavings:    "💰",
  rebalancePortfolio: "⚖️",
  checkGoalProgress:  "📊",
  checkFxDrift:       "💱",
  hedgeFxExposure:    "🛡️",
  withdrawAll:        "📤",
};

const EXPLORER = process.env.NEXT_PUBLIC_APP_ENV === "prod"
  ? "https://celo.blockscout.com/tx/"
  : "https://celo-sepolia.blockscout.com/tx/";

export default function ActivityPage() {
  const { ready, authenticated, user } = usePrivy();
  const router  = useRouter();
  const address = user?.wallet?.address;
  const [executions, setExecutions] = useState<ExecutionEntry[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState<string>("all");

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) { router.push("/"); return; }
    if (!address) return;
    api.getGoalHistory(address)
      .then(h => setExecutions((h as GoalHistory).executions ?? []))
      .finally(() => setLoading(false));
  }, [ready, authenticated, address]);

  const filtered = filter === "all"
    ? executions
    : executions.filter(e => e.status === filter);

  return (
    <AppShell>
      <div style={{ marginBottom: 26 }}>
        <h1 className="font-display" style={{ fontSize: 21, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.03em" }}>Activity</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 12.5, marginTop: 2 }}>
          {loading ? "Loading…" : `${executions.length} total action${executions.length !== 1 ? "s" : ""} by Piggy`}
        </p>
      </div>

      {/* Filter pills */}
      {!loading && executions.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {(["all", "confirmed", "pending", "failed"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className="btn btn-sm"
              style={{ borderRadius: "var(--radius-full)", border: "1.5px solid", borderColor: filter === f ? "var(--accent)" : "var(--border)", background: filter === f ? "var(--accent-pale)" : "transparent", color: filter === f ? "var(--accent)" : "var(--text-secondary)", fontWeight: filter === f ? 600 : 400, padding: "6px 14px" }}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f !== "all" && (
                <span style={{ marginLeft: 5, fontSize: 10, background: filter === f ? "var(--accent-light)" : "var(--bg-secondary)", padding: "1px 6px", borderRadius: "var(--radius-full)" }}>
                  {executions.filter(e => e.status === f).length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[0,1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: 62, borderRadius: "var(--radius-md)" }} />)}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="card" style={{ padding: "52px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🐷</div>
          <p style={{ color: "var(--text-tertiary)", fontSize: 14 }}>
            {filter !== "all" ? `No "${filter}" actions yet.` : "No activity yet — Piggy will start shortly."}
          </p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="card" style={{ overflow: "hidden" }}>
          {filtered.map((h, i) => (
            <div key={h.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: i < filtered.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0, background: h.status === "confirmed" ? "var(--accent-pale)" : h.status === "failed" ? "var(--red-light)" : "var(--amber-light)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, border: `1px solid ${h.status === "confirmed" ? "var(--accent-light)" : h.status === "failed" ? "var(--red-light)" : "var(--amber-light)"}` }}>
                  {SKILL_ICONS[h.skill_name] ?? "⚙️"}
                </div>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-primary)" }}>
                    {h.skill_name.replace(/([A-Z])/g, " $1").trim()}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 1 }}>
                    {new Date(h.created_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className={`badge ${h.status === "confirmed" ? "badge-green" : h.status === "failed" ? "badge-red" : "badge-amber"}`}>
                  {h.status}
                </div>
                {h.tx_hash && (
                  <a href={`${EXPLORER}${h.tx_hash}`} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 11, color: "var(--accent)", background: "var(--accent-pale)", border: "1px solid var(--accent-light)", padding: "3px 8px", borderRadius: "var(--radius-full)", textDecoration: "none" }}>
                    ↗ Tx
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
