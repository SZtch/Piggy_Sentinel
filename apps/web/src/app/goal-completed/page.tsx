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

  const [goal,     setGoal]    = useState<GoalData | null>(null);
  const [loading,  setLoading] = useState(true);
  const [choice,   setChoice]  = useState<Choice>(null);
  const [saving,   setSaving]  = useState(false);
  const [done,     setDone]    = useState(false);
  const [error,    setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) { router.push("/"); return; }
    if (!address) return;
    api.getGoalStatus(address)
      .then(g => {
        const gd = g as GoalData;
        if (!gd?.id || gd.status !== "completed") { router.push("/dashboard"); return; }
        setGoal(gd);
      })
      .catch(() => router.push("/dashboard"))
      .finally(() => setLoading(false));
  }, [ready, authenticated, address]);

  async function handleConfirm() {
    if (!goal || !choice) return;
    setSaving(true); setError(null);
    try {
      await api.completeGoalAction(goal.id, choice);
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading || !goal) return (
    <AppShell>
      <div className="card skeleton" style={{ height: 300, maxWidth: 520 }} />
    </AppShell>
  );

  const progress   = goal.progress_pct ? parseFloat(goal.progress_pct) : 0;
  const targetAmt  = Number(goal.target_amount) / 1e18;
  const currentAmt = targetAmt * (progress / 100);
  const yieldAmt   = goal.yield_earned ? Number(goal.yield_earned) / 1e18 : 0;
  const apyMin     = goal.strategy_json?.expectedApyMin ?? 5.5;
  const apyMax     = goal.strategy_json?.expectedApyMax ?? 7.0;

  // ── DONE STATE ──────────────────────────────────────────────────────────────
  if (done) return (
    <AppShell>
      <div style={{ maxWidth: 520 }}>
        <div style={{ textAlign: "center", padding: "40px 0 28px" }}>
          <div style={{ fontSize: 52, marginBottom: 12 }}>
            {choice === "withdraw" ? "💸" : choice === "continue" ? "🚀" : "🐷"}
          </div>
          <h2 className="font-display" style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.03em", marginBottom: 8 }}>
            {choice === "withdraw" ? "Withdrawal queued"
              : choice === "continue" ? "Keeping your money working"
              : "Ready for your next goal!"}
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
            {choice === "withdraw" ? "Piggy is closing positions. Funds return to your wallet shortly."
              : choice === "continue" ? "Piggy will keep earning yield. You can withdraw anytime."
              : "Create a new goal whenever you're ready."}
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button className="btn btn-secondary" onClick={() => router.push("/goals")}>My Goals</button>
          <button className="btn btn-primary" onClick={() => router.push(choice === "new_goal" ? "/enable" : "/dashboard")}>
            {choice === "new_goal" ? "New goal →" : "Dashboard →"}
          </button>
        </div>
      </div>
    </AppShell>
  );

  // ── MAIN ────────────────────────────────────────────────────────────────────
  return (
    <AppShell>
      <div style={{ maxWidth: 520 }}>

        {/* Celebration header */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>🎉</div>
          <h1 className="font-display" style={{ fontSize: 24, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.04em", marginBottom: 6 }}>
            Goal reached!
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 15 }}>
            {goal.goal_name ? `"${goal.goal_name}" is complete.` : "Your savings goal is complete."}
          </p>
        </div>

        {/* Summary card */}
        <div className="card" style={{ overflow: "hidden", marginBottom: 24 }}>
          <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border-subtle)", display: "grid", gridTemplateColumns: "1fr 1fr 1fr" }}>
            {[
              { label: "Total saved",   value: `$${currentAmt.toFixed(2)}`, accent: false },
              { label: "Yield earned",  value: `+$${yieldAmt.toFixed(2)}`,  accent: true  },
              { label: "Blended APY",   value: `${apyMin}–${apyMax}%`,       accent: true  },
            ].map((s, i) => (
              <div key={s.label} style={{ borderRight: i < 2 ? "1px solid var(--border-subtle)" : "none", paddingRight: i < 2 ? 14 : 0, paddingLeft: i > 0 ? 14 : 0 }}>
                <div className="stat-label" style={{ marginBottom: 4 }}>{s.label}</div>
                <div className="font-display" style={{ fontSize: 18, fontWeight: 700, color: s.accent ? "var(--accent)" : "var(--text-primary)" }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: "10px 22px" }}>
            <div className="progress-track" style={{ height: 6 }}>
              <div className="progress-fill" style={{ width: "100%" }} />
            </div>
            <div style={{ fontSize: 11, color: "var(--accent)", marginTop: 6, fontWeight: 600 }}>✓ 100% complete</div>
          </div>
        </div>

        {/* 3 choices */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 14 }}>What would you like to do?</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {([
              {
                value:   "withdraw" as const,
                emoji:   "💸",
                title:   "Withdraw funds",
                desc:    "Close all positions and return your money to your wallet.",
                color:   "var(--text-primary)",
              },
              {
                value:   "continue" as const,
                emoji:   "📈",
                title:   "Keep earning yield",
                desc:    `Continue the strategy and keep earning ${apyMin}–${apyMax}% APY on your savings.`,
                color:   "var(--accent)",
              },
              {
                value:   "new_goal" as const,
                emoji:   "🐷",
                title:   "Start a new goal",
                desc:    "Withdraw and set a brand new savings target.",
                color:   "var(--text-primary)",
              },
            ]).map(opt => (
              <button
                key={opt.value}
                onClick={() => setChoice(opt.value)}
                style={{
                  display:       "flex",
                  alignItems:    "center",
                  gap:           14,
                  padding:       "16px 18px",
                  background:    choice === opt.value ? "var(--accent-pale)" : "var(--bg-card)",
                  border:        `1.5px solid ${choice === opt.value ? "var(--accent)" : "var(--border)"}`,
                  borderRadius:  "var(--radius-lg)",
                  cursor:        "pointer",
                  textAlign:     "left",
                  transition:    "all 0.15s ease",
                  width:         "100%",
                }}
              >
                <div style={{ width: 40, height: 40, borderRadius: "var(--radius-md)", background: choice === opt.value ? "var(--accent-light)" : "var(--bg-secondary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
                  {opt.emoji}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14.5, color: choice === opt.value ? "var(--accent)" : opt.color, marginBottom: 3 }}>
                    {opt.title}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.4 }}>{opt.desc}</div>
                </div>
                <div style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${choice === opt.value ? "var(--accent)" : "var(--border)"}`, background: choice === opt.value ? "var(--accent)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {choice === opt.value && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff" }} />}
                </div>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div style={{ background: "var(--red-light)", color: "var(--red)", borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>⚠ {error}</div>
        )}

        <button
          className="btn btn-primary"
          style={{ width: "100%" }}
          onClick={handleConfirm}
          disabled={!choice || saving}
        >
          {saving ? "Processing…" : choice ? `Confirm — ${
            choice === "withdraw" ? "Withdraw funds" :
            choice === "continue" ? "Keep earning" :
            "Start new goal"
          }` : "Choose an option above"}
        </button>
      </div>
    </AppShell>
  );
}
