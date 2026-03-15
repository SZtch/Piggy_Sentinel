"use client";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { api, type ExecutionEntry, type GoalHistory } from "@/lib/api";

const EXPLORER = process.env.NEXT_PUBLIC_APP_ENV === "prod"
  ? "https://celo.blockscout.com/tx/"
  : "https://celo-sepolia.blockscout.com/tx/";

const SKILL_LABEL: Record<string, string> = {
  allocateSavings:           "allocate_savings",
  rebalancePortfolio:        "rebalance_portfolio",
  checkGoalProgress:         "check_progress",
  executeMentoSwapAndSupply: "mento_swap_supply",
  executeAaveSupply:         "aave_supply",
  executeAaveWithdraw:       "aave_withdraw",
  checkAndExitLPIfIL:        "il_stop_loss",
  withdrawAll:               "withdraw_all",
};

function Dot({ status }: { status: string }) {
  const c = status === "confirmed" ? "var(--green)" : status === "failed" ? "var(--red)" : "var(--amber)";
  return <span style={{ width: 6, height: 6, borderRadius: "50%", background: c, display: "inline-block", flexShrink: 0 }} />;
}

type Filter = "all" | "confirmed" | "pending" | "failed";

export default function ActivityPage() {
  const { ready, authenticated, user } = usePrivy();
  const router  = useRouter();
  const address = user?.wallet?.address;

  const [executions, setExecutions] = useState<ExecutionEntry[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState<Filter>("all");

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) { router.push("/"); return; }
    if (!address) return;
    const load = () => api.getGoalHistory(address)
      .then(h => setExecutions((h as GoalHistory).executions ?? []))
      .finally(() => setLoading(false));
    load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, [ready, authenticated, address]);

  const filtered = filter === "all" ? executions : executions.filter(e => e.status === filter);

  return (
    <AppShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1>Activity</h1>
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text3)" }}>
            {loading ? "…" : `${executions.length} events`}
          </span>
        </div>

        {/* Filter tabs */}
        <div style={{ display: "flex", gap: 2, background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 6, padding: 2 }}>
          {(["all", "confirmed", "pending", "failed"] as Filter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: "4px 10px", borderRadius: 4,
              fontSize: 11, fontFamily: "var(--mono)",
              background: filter === f ? "var(--bg3)" : "transparent",
              color: filter === f ? "var(--text)" : "var(--text3)",
              border: "none", cursor: "pointer",
              transition: "all 0.15s",
            }}>
              {f}
              {f !== "all" && (
                <span style={{ marginLeft: 5, color: "var(--text3)" }}>
                  {executions.filter(e => e.status === f).length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 1, background: "var(--border)", borderRadius: 8, overflow: "hidden" }}>
          {[0,1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: 44 }} />)}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="card" style={{ padding: "48px", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🐷</div>
          <p style={{ color: "var(--text2)" }}>
            {filter !== "all" ? `No "${filter}" events.` : "No activity yet — Piggy will start soon."}
          </p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Timestamp</th>
                <th>Status</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(h => (
                <tr key={h.id}>
                  <td>
                    <span style={{ fontFamily: "var(--mono)", color: "var(--text)", fontSize: 12 }}>
                      {SKILL_LABEL[h.skill_name] ?? h.skill_name}
                    </span>
                  </td>
                  <td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                    {new Date(h.created_at).toLocaleString("en-US", {
                      year: "numeric", month: "short", day: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Dot status={h.status} />
                      <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text2)" }}>{h.status}</span>
                    </div>
                  </td>
                  <td>
                    {h.tx_hash ? (
                      <a href={`${EXPLORER}${h.tx_hash}`} target="_blank" rel="noopener noreferrer"
                        style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--green)", textDecoration: "none" }}>
                        {h.tx_hash.slice(0, 8)}…{h.tx_hash.slice(-6)} ↗
                      </a>
                    ) : (
                      <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text3)" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
