"use client";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { api, type GoalData } from "@/lib/api";

type Choice = "withdraw" | "continue" | "new_goal" | null;

export default function GoalCompletedPage() {
  const { ready, authenticated, user } = usePrivy();
  const router  = useRouter();
  const address = user?.wallet?.address;

  const [goal,    setGoal]    = useState<GoalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [choice,  setChoice]  = useState<Choice>(null);
  const [saving,  setSaving]  = useState(false);
  const [done,    setDone]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) { router.push("/"); return; }
    if (!address) return;
    api.getGoalStatus(address).then(g => {
      const gd = g as GoalData;
      if (!gd?.id || gd.status !== "completed") { router.push("/dashboard"); return; }
      setGoal(gd);
    }).catch(() => router.push("/dashboard")).finally(() => setLoading(false));
  }, [ready, authenticated, address]);

  async function handleConfirm() {
    if (!goal || !choice) return;
    setSaving(true); setError(null);
    try {
      await api.completeGoalAction(goal.id, choice);
      setDone(true);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  if (loading || !goal) return (
    <AppShell>
      <div className="skeleton" style={{ height: 300, maxWidth: 480, borderRadius: 8 }} />
    </AppShell>
  );

  const targetAmt = Number(goal.target_amount) / 1e18;
  const yieldAmt  = goal.yield_earned ? Number(goal.yield_earned) / 1e18 : 0;

  if (done) return (
    <AppShell>
      <div style={{ maxWidth: 440 }}>
        <h1 style={{ marginBottom: 8 }}>
          {choice === "withdraw" ? "Withdrawal initiated" : choice === "continue" ? "Keeping it working" : "Ready for next goal"}
        </h1>
        <p style={{ color: "var(--text2)", fontSize: 13, marginBottom: 24 }}>
          {choice === "withdraw" ? "Piggy is closing positions. USDm returns to your wallet shortly."
            : choice === "continue" ? "Piggy keeps earning yield. Withdraw anytime from the agent page."
            : "Create a new goal whenever you're ready."}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => router.push("/goals")}>My goals</button>
          <button className="btn btn-primary" onClick={() => router.push("/dashboard")}>Dashboard →</button>
        </div>
      </div>
    </AppShell>
  );

  const OPTIONS: { value: Choice; title: string; desc: string; primary?: boolean }[] = [
    { value: "withdraw",  title: "Withdraw funds",    desc: "Close all positions and return USDm to your wallet." },
    { value: "continue",  title: "Keep earning",      desc: "Leave funds in Aave — Piggy continues managing.", primary: true },
    { value: "new_goal",  title: "Set a new goal",    desc: "Start saving for something else with a fresh target." },
  ];

  return (
    <AppShell>
      <div style={{ maxWidth: 440 }}>
        <div style={{ marginBottom: 24 }}>
          <span className="badge badge-green" style={{ marginBottom: 12, display: "inline-flex" }}>Goal reached</span>
          <h1 style={{ marginBottom: 6 }}>
            You saved ${targetAmt.toFixed(0)}
          </h1>
          <p style={{ color: "var(--text2)", fontSize: 13 }}>
            +${yieldAmt.toFixed(2)} yield earned. What would you like to do next?
          </p>
        </div>

        {error && (
          <div style={{ background: "var(--red-dim)", border: "1px solid #F0606030", borderRadius: 6, padding: "10px 12px", marginBottom: 16, fontSize: 12, color: "var(--red)", fontFamily: "var(--mono)" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          {OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => setChoice(opt.value)} style={{
              background: choice === opt.value ? "var(--green-dim)" : "var(--bg2)",
              border: `1px solid ${choice === opt.value ? "var(--green)" : "var(--border)"}`,
              borderRadius: 8, padding: "14px 16px",
              textAlign: "left", cursor: "pointer",
              transition: "all 0.15s",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", marginBottom: 3 }}>
                  {opt.title}
                </div>
                {choice === opt.value && (
                  <span style={{ color: "var(--green)", fontSize: 14, fontWeight: 600 }}>✓</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--text3)" }}>{opt.desc}</div>
            </button>
          ))}
        </div>

        <button
          className="btn btn-primary"
          onClick={handleConfirm}
          disabled={!choice || saving}
          style={{ width: "100%" }}
        >
          {saving ? "…" : "Confirm →"}
        </button>
      </div>
    </AppShell>
  );
}
