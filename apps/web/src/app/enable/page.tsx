"use client";
import { useState, useEffect } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom, parseUnits } from "viem";
import { celo } from "viem/chains";
import { defineChain } from "viem";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";
import { api } from "@/lib/api";

const celoSepolia = defineChain({
  id: 11142220, name: "Celo Sepolia",
  nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
  rpcUrls: { default: { http: ["https://forno.celo-sepolia.celo.org"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://celo-sepolia.blockscout.com" } },
  testnet: true,
});
const EXECUTOR   = process.env.NEXT_PUBLIC_SENTINEL_EXECUTOR_ADDRESS as `0x${string}`;
const USDM_ADDR  = process.env.NEXT_PUBLIC_USDM_ADDRESS as `0x${string}`;
const IS_MAINNET = process.env.NEXT_PUBLIC_APP_ENV === "prod";
const CHAIN      = IS_MAINNET ? celo : celoSepolia;
const EXPLORER   = IS_MAINNET ? "https://celo.blockscout.com/tx/" : "https://celo-sepolia.blockscout.com/tx/";
const ERC20_ABI  = [{ name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }] as const;

type Step = "goal" | "contribution" | "limits" | "permission" | "notifications" | "done";
type Risk = "conservative" | "moderate" | "aggressive";
type ContribPattern = "recurring" | "manual";

const STEPS: Step[] = ["goal", "contribution", "limits", "permission", "notifications", "done"];
const STEP_META: Record<Step, { label: string; desc: string }> = {
  goal:          { label: "Your goal",        desc: "What are you saving for?"     },
  contribution:  { label: "Contributions",    desc: "How will you add funds?"      },
  limits:        { label: "Spending limits",  desc: "How much can Piggy use?"      },
  permission:    { label: "Grant permission", desc: "One-time wallet approval"     },
  notifications: { label: "Notifications",    desc: "Stay in the loop"             },
  done:          { label: "All set",          desc: "Piggy is ready"               },
};
const RISK_OPTIONS = [
  { value: "conservative" as Risk, emoji: "🛡️", label: "Play it safe",  apy: "~5.5%",  desc: "Stable yield only via Aave" },
  { value: "moderate"     as Risk, emoji: "⚖️", label: "Balanced",       apy: "~7.2%",  desc: "Aave + small LP position"  },
  { value: "aggressive"   as Risk, emoji: "🚀", label: "Growth mode",    apy: "~10.1%", desc: "Aave + LP + WETH exposure" },
];
const ALLOC: Record<Risk, { label: string; protocol: string; pct: number; color: string }[]> = {
  conservative: [{ label: "USDT", protocol: "Aave", pct: 60, color: "#0A6B4B" }, { label: "USDC", protocol: "Aave", pct: 30, color: "#0D8A60" }, { label: "USDm", protocol: "Aave", pct: 10, color: "#18C77A" }],
  moderate:     [{ label: "USDT", protocol: "Aave", pct: 56, color: "#0A6B4B" }, { label: "USDC", protocol: "Aave", pct: 24, color: "#0D8A60" }, { label: "USDm", protocol: "Aave", pct: 8, color: "#18C77A" }, { label: "USDC/WETH", protocol: "LP", pct: 12, color: "#B45309" }],
  aggressive:   [{ label: "USDT", protocol: "Aave", pct: 36, color: "#0A6B4B" }, { label: "USDC", protocol: "Aave", pct: 16, color: "#0D8A60" }, { label: "USDm", protocol: "Aave", pct: 8, color: "#18C77A" }, { label: "USDC/WETH", protocol: "LP", pct: 30, color: "#B45309" }, { label: "WETH", protocol: "hold", pct: 10, color: "#1D4ED8" }],
};

const Bubble = ({ msg }: { msg: string }) => (
  <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginBottom: 18 }}>
    <div style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0, background: "linear-gradient(135deg, var(--accent-pale), var(--accent-light))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, border: "2px solid var(--accent-light)" }}>🐷</div>
    <div style={{ background: "var(--bg-card)", border: "1.5px solid var(--border)", borderRadius: "18px 18px 18px 4px", padding: "12px 16px", maxWidth: 320, boxShadow: "var(--shadow-sm)" }}>
      <p style={{ fontSize: 13.5, color: "var(--text-primary)", lineHeight: 1.55, margin: 0, whiteSpace: "pre-wrap" }}>{msg}</p>
    </div>
  </div>
);

const Lbl = ({ children }: { children: React.ReactNode }) => (
  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.07em" }}>{children}</label>
);

const ErrBanner = ({ msg, onClose }: { msg: string; onClose: () => void }) => (
  <div style={{ background: "var(--red-light)", color: "var(--red)", borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 14, fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
    ⚠ {msg} <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--red)", cursor: "pointer" }}>✕</button>
  </div>
);

const $Input = ({ label, value, onChange, placeholder, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) => (
  <div>
    <Lbl>{label}</Lbl>
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)", fontWeight: 600 }}>$</span>
      <input type="number" min="0" placeholder={placeholder ?? "0"} value={value} onChange={e => onChange(e.target.value)} className="input" style={{ paddingLeft: 28 }} />
    </div>
    {hint && <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>{hint}</div>}
  </div>
);

function StepBar({ current }: { current: Step }) {
  const idx = STEPS.indexOf(current);
  const visibleSteps = STEPS.filter(s => s !== "done");
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        {visibleSteps.map((s, i) => {
          const done = i < idx; const active = i === idx;
          return (
            <div key={s} style={{ display: "flex", alignItems: "center", flex: i < visibleSteps.length - 1 ? 1 : 0 }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, background: done || active ? "var(--accent)" : "var(--bg-secondary)", border: `2px solid ${done || active ? "var(--accent)" : "var(--border)"}`, color: done || active ? "#fff" : "var(--text-tertiary)", flexShrink: 0, transition: "all 0.3s" }}>
                {done ? "✓" : i + 1}
              </div>
              {i < visibleSteps.length - 1 && <div style={{ flex: 1, height: 2, background: done ? "var(--accent)" : "var(--border)", margin: "0 3px", transition: "background 0.3s" }} />}
            </div>
          );
        })}
      </div>
      <div className="font-display" style={{ fontWeight: 700, fontSize: 17, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>{STEP_META[current].label}</div>
      <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", marginTop: 2 }}>{STEP_META[current].desc}</div>
    </div>
  );
}

function Shell({ children, step }: { children: React.ReactNode; step: Step }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <nav style={{ height: 56, borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 max(20px, calc(50% - 480px))", position: "sticky", top: 0, zIndex: 40, backdropFilter: "blur(12px)", background: "color-mix(in srgb, var(--bg) 88%, transparent)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>🐷</span>
          <span className="font-display" style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)" }}>Piggy</span>
        </div>
        <ThemeToggle />
      </nav>
      <div style={{ display: "flex", justifyContent: "center", padding: "30px 20px 72px" }}>
        <div style={{ width: "100%", maxWidth: 460 }}>
          <StepBar current={step} />
          <div className="animate-fade-up">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function EnablePiggyPage() {
  const { ready, authenticated, login, user } = usePrivy();
  const { wallets } = useWallets();
  const router  = useRouter();
  const address = user?.wallet?.address as `0x${string}` | undefined;

  const [step,        setStep]        = useState<Step>("goal");
  const [goalName,    setGoalName]    = useState("");
  const [amount,      setAmount]      = useState("");
  const [target,      setTarget]      = useState("");
  const [months,      setMonths]      = useState("12");
  const [risk,        setRisk]        = useState<Risk>("moderate");
  const [pattern,     setPattern]     = useState<ContribPattern>("recurring");
  const [weeklyAmt,   setWeeklyAmt]   = useState("");
  const [maxPerExec,  setMaxPerExec]  = useState("");
  const [maxPerWeek,  setMaxPerWeek]  = useState("");
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [txHash,      setTxHash]      = useState<string | null>(null);
  const [tgCode,      setTgCode]      = useState<string | null>(null);

  useEffect(() => { if (ready && !authenticated) login(); }, [ready, authenticated]);
  useEffect(() => {
    if (step === "limits" && !maxPerExec && weeklyAmt) { setMaxPerExec(weeklyAmt); setMaxPerWeek((parseFloat(weeklyAmt) * 1.5 || 0).toFixed(0)); }
  }, [step]);

  const targetNum  = parseFloat(target) || 0;
  const amountNum  = parseFloat(amount) || 0;
  const weeklyNum  = parseFloat(weeklyAmt) || 0;
  const monthsNum  = parseInt(months) || 12;
  const chosenRisk = RISK_OPTIONS.find(r => r.value === risk)!;
  const apyNum     = parseFloat(chosenRisk.apy.replace("~","").replace("%","")) / 100;
  const yieldEst   = targetNum * apyNum * (monthsNum / 12);
  const deadline   = new Date(Date.now() + monthsNum * 30 * 24 * 3_600_000).toISOString().split("T")[0];

  async function handleGrantPermission() {
    if (!address || !wallets[0]) { setError("Wallet not ready"); return; }
    setLoading(true); setError(null);
    try {
      const provider = await wallets[0].getEthereumProvider();
      const client   = createWalletClient({ account: address, chain: CHAIN, transport: custom(provider) });
      const { goal } = await api.createGoal({
        ownerWallet: address, agentWalletAddress: EXECUTOR ?? address,
        targetAmount: parseUnits(targetNum.toString(), 18).toString(),
        targetCurrency: "USDm", deadlineDate: deadline,
        weeklyContribution: weeklyNum ? parseUnits(weeklyNum.toString(), 18).toString() : undefined,
        contributionPattern: pattern, goalName: goalName || undefined,
        maxPerExecution: maxPerExec ? parseUnits(maxPerExec, 18).toString() : undefined,
        maxPerWeek: maxPerWeek ? parseUnits(maxPerWeek, 18).toString() : undefined,
      });
      const approvalAmt = maxPerWeek ? parseFloat(maxPerWeek) * 4 * monthsNum : targetNum * 1.1;
      const hash = await client.writeContract({ address: USDM_ADDR ?? "0x0", abi: ERC20_ABI, functionName: "approve", args: [EXECUTOR ?? "0x0", parseUnits(approvalAmt.toFixed(6), 18)] });
      setTxHash(hash);
      await api.activateGoal(goal.id);
      setStep("notifications");
    } catch (err) { setError(err instanceof Error ? err.message : "Transaction failed"); }
    finally { setLoading(false); }
  }

  async function handleTelegram() {
    if (!address) return;
    setLoading(true);
    try { const { code } = await api.requestTelegramLink(address); setTgCode(code); }
    catch { setStep("done"); }
    finally { setLoading(false); }
  }

  // ── GOAL ────────────────────────────────────────────────────────────────────
  if (step === "goal") return (
    <Shell step="goal">
      <Bubble msg="Hey! Tell me what you're saving for. I'll build a strategy around it. 🐷" />
      <div className="card" style={{ padding: "24px" }}>
        {error && <ErrBanner msg={error} onClose={() => setError(null)} />}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <Lbl>Goal name (optional)</Lbl>
            <input type="text" placeholder="Vacation, Emergency fund, New laptop…" value={goalName} onChange={e => setGoalName(e.target.value)} className="input" />
          </div>
          <$Input label="Starting amount (USDm)" value={amount} onChange={v => { setAmount(v); setTarget(v); }} placeholder="500" hint="Min $20 testnet · $100 mainnet" />
          <$Input label="Savings target (USDm)" value={target} onChange={setTarget} placeholder="2000" />
          <div>
            <Lbl>Timeline</Lbl>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
              {["3","6","12","24"].map(m => (
                <button key={m} onClick={() => setMonths(m)} className="btn" style={{ padding: "10px 0", fontSize: 13, border: "1.5px solid", borderColor: months===m?"var(--accent)":"var(--border)", background: months===m?"var(--accent-pale)":"var(--bg-secondary)", color: months===m?"var(--accent)":"var(--text-secondary)", fontWeight: months===m?600:400, borderRadius: "var(--radius-md)" }}>{m}mo</button>
              ))}
            </div>
          </div>
          <div>
            <Lbl>Growth strategy</Lbl>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {RISK_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => setRisk(opt.value)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: risk===opt.value?"var(--accent-pale)":"var(--bg-secondary)", border: `1.5px solid ${risk===opt.value?"var(--accent)":"var(--border)"}`, borderRadius: "var(--radius-md)", cursor: "pointer", transition: "all 0.15s", textAlign: "left" }}>
                  <span style={{ fontSize: 18 }}>{opt.emoji}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: risk===opt.value?"var(--accent)":"var(--text-primary)" }}>{opt.label}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 1 }}>{opt.desc}</div>
                  </div>
                  <div className="font-display" style={{ fontWeight: 700, fontSize: 15, color: risk===opt.value?"var(--accent)":"var(--text-secondary)" }}>{opt.apy}</div>
                </button>
              ))}
            </div>
          </div>
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => setStep("contribution")} disabled={!amount || parseFloat(amount) < 1}>Continue →</button>
        </div>
      </div>
    </Shell>
  );

  // ── CONTRIBUTION ────────────────────────────────────────────────────────────
  if (step === "contribution") return (
    <Shell step="contribution">
      <Bubble msg="How do you want to add funds? I'll automate it for you." />
      <div className="card" style={{ padding: "24px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <Lbl>Contribution pattern</Lbl>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {([
                { value: "recurring", emoji: "🔁", label: "Recurring",    desc: "Piggy moves funds automatically" },
                { value: "manual",    emoji: "👆", label: "Manual top-up", desc: "You add funds when you want" },
              ] as const).map(opt => (
                <button key={opt.value} onClick={() => setPattern(opt.value)} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, padding: "14px 12px", background: pattern===opt.value?"var(--accent-pale)":"var(--bg-secondary)", border: `1.5px solid ${pattern===opt.value?"var(--accent)":"var(--border)"}`, borderRadius: "var(--radius-md)", cursor: "pointer", textAlign: "left", transition: "all 0.15s" }}>
                  <span style={{ fontSize: 20 }}>{opt.emoji}</span>
                  <div style={{ fontWeight: 600, fontSize: 13, color: pattern===opt.value?"var(--accent)":"var(--text-primary)" }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)", lineHeight: 1.4 }}>{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>
          {pattern === "recurring" && (
            <div className="animate-fade-in">
              <$Input label="Weekly contribution (USDm)" value={weeklyAmt} onChange={setWeeklyAmt}
                placeholder={targetNum > 0 ? (targetNum / (monthsNum * 4.33)).toFixed(0) : "50"}
                hint={targetNum > 0 && weeklyAmt
                  ? `${Math.ceil(targetNum / parseFloat(weeklyAmt) / 4.33)} months to reach $${targetNum.toLocaleString()}`
                  : `Suggested: $${(targetNum / (monthsNum * 4.33)).toFixed(0)}/week`}
              />
            </div>
          )}
          {(pattern === "manual" || weeklyAmt) && (
            <div className="card-inset" style={{ padding: "12px 14px", borderRadius: "var(--radius-md)", display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ fontSize: 15 }}>💡</span>
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                {pattern === "recurring" && weeklyAmt
                  ? `Piggy will automatically move $${weeklyAmt}/week to keep you on track.`
                  : "You're in full control. Piggy manages whatever you send, whenever you send it."}
              </div>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button className="btn btn-secondary" onClick={() => setStep("goal")}>← Back</button>
            <button className="btn btn-primary" onClick={() => setStep("limits")} disabled={pattern==="recurring" && !weeklyAmt}>Continue →</button>
          </div>
        </div>
      </div>
    </Shell>
  );

  // ── LIMITS ──────────────────────────────────────────────────────────────────
  if (step === "limits") return (
    <Shell step="limits">
      <Bubble msg="Set spending limits so Piggy can only use what you allow. These are enforced on-chain." />
      <div className="card" style={{ padding: "24px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <$Input label="Max per execution (USDm)" value={maxPerExec} onChange={setMaxPerExec} placeholder={weeklyAmt || "50"} hint="Max Piggy can move in a single transaction" />
          <$Input label="Max per week (USDm)" value={maxPerWeek} onChange={setMaxPerWeek} placeholder={weeklyAmt ? (parseFloat(weeklyAmt) * 1.5).toFixed(0) : "200"} hint="Weekly cap across all executions" />
          {maxPerExec && maxPerWeek && (
            <div className="card-accent animate-fade-in" style={{ padding: "14px 16px", borderRadius: "var(--radius-md)" }}>
              <div style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600, marginBottom: 10 }}>🛡️ Your spending limits</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  { l: "Per execution",    v: `$${parseFloat(maxPerExec).toFixed(2)}` },
                  { l: "Per week",         v: `$${parseFloat(maxPerWeek).toFixed(2)}` },
                  { l: "Total approval",   v: `$${(parseFloat(maxPerWeek) * 4 * monthsNum).toFixed(0)}` },
                  { l: "Over",             v: `${monthsNum} months` },
                ].map(s => (
                  <div key={s.l}>
                    <div style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.l}</div>
                    <div className="font-display" style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginTop: 2 }}>{s.v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", background: "var(--bg-secondary)", borderRadius: "var(--radius-md)", padding: "10px 12px", lineHeight: 1.5 }}>
            💡 Piggy <strong style={{ color: "var(--text-primary)" }}>cannot</strong> exceed these limits. They are enforced by the smart contract — not just a setting.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button className="btn btn-secondary" onClick={() => setStep("contribution")}>← Back</button>
            <button className="btn btn-primary" onClick={() => setStep("permission")} disabled={!maxPerExec || !maxPerWeek}>Review →</button>
          </div>
        </div>
      </div>
    </Shell>
  );

  // ── PERMISSION ──────────────────────────────────────────────────────────────
  if (step === "permission") return (
    <Shell step="permission">
      <Bubble msg="One signature is all it takes. Piggy can only act within the limits you just set — nothing else." />
      <div className="card" style={{ overflow: "hidden", marginBottom: 14 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span className="font-display" style={{ fontWeight: 700, fontSize: 16, color: "var(--text-primary)" }}>{goalName || "My Savings Goal"}</span>
            <div className="badge badge-green">{chosenRisk.emoji} {chosenRisk.label}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 0 }}>
            {[
              { l: "Target",    v: `$${targetNum.toLocaleString()}` },
              { l: "Timeline",  v: `${monthsNum}mo`                 },
              { l: "Est. yield",v: `+$${yieldEst.toFixed(0)}`, accent: true },
            ].map((s,i) => (
              <div key={s.l} style={{ borderRight: i < 2 ? "1px solid var(--border-subtle)" : "none", paddingRight: i < 2 ? 14 : 0, paddingLeft: i > 0 ? 14 : 0 }}>
                <div style={{ fontSize: 10, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{s.l}</div>
                <div className="font-display" style={{ fontWeight: 700, fontSize: 17, color: (s as { accent?: boolean }).accent ? "var(--accent)" : "var(--text-primary)" }}>{s.v}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 2 }}>Contribution</div>
            <div style={{ fontSize: 13.5, fontWeight: 500 }}>{pattern === "recurring" ? `$${weeklyAmt}/week · automatic` : "Manual top-ups"}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>Spending limits</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>${maxPerExec}/tx · ${maxPerWeek}/wk</div>
          </div>
        </div>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 8 }}>Strategy allocation</div>
          <div style={{ height: 7, borderRadius: "var(--radius-full)", overflow: "hidden", display: "flex", gap: 1.5, marginBottom: 8 }}>
            {ALLOC[risk].map(a => <div key={a.label} style={{ flex: a.pct, background: a.color }} />)}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {ALLOC[risk].map(a => (
              <div key={a.label} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: a.color }} />
                <span style={{ color: "var(--text-secondary)" }}>{a.label} {a.pct}%</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ padding: "10px 20px", background: "var(--bg-secondary)", display: "flex", flexWrap: "wrap", gap: 14 }}>
          {["Funds stay in your wallet", "Revoke anytime", "20% fee on yield only"].map(t => (
            <div key={t} style={{ fontSize: 11.5, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "var(--accent)" }}>✓</span> {t}
            </div>
          ))}
        </div>
      </div>
      {error && <ErrBanner msg={error} onClose={() => setError(null)} />}
      {txHash && <a href={`${EXPLORER}${txHash}`} target="_blank" rel="noopener noreferrer" style={{ display: "block", textAlign: "center", marginBottom: 10, fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>↗ View transaction</a>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <button className="btn btn-secondary" onClick={() => setStep("limits")} disabled={loading}>← Back</button>
        <button className="btn btn-primary" onClick={handleGrantPermission} disabled={loading}>{loading ? "Signing…" : "Grant permission 🔑"}</button>
      </div>
    </Shell>
  );

  // ── NOTIFICATIONS ───────────────────────────────────────────────────────────
  if (step === "notifications") return (
    <Shell step="notifications">
      <Bubble msg={"Piggy is live! 🎉\n\nWant Telegram alerts when you hit milestones?"} />
      <div className="card" style={{ padding: "24px" }}>
        {!tgCode ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button className="btn btn-primary" style={{ width: "100%" }} onClick={handleTelegram} disabled={loading}>{loading ? "Generating…" : "📱 Connect Telegram"}</button>
            <button className="btn btn-secondary" style={{ width: "100%" }} onClick={() => setStep("done")}>Skip for now</button>
          </div>
        ) : (
          <div style={{ textAlign: "center" }}>
            <div style={{ background: "var(--accent-pale)", border: "1px solid var(--accent-light)", borderRadius: "var(--radius-md)", padding: "18px", marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Your link code</div>
              <div className="font-display" style={{ fontSize: 32, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.08em" }}>{tgCode}</div>
            </div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 18, lineHeight: 1.6 }}>
              Send <code style={{ background: "var(--bg-secondary)", padding: "2px 6px", borderRadius: "var(--radius-xs)", fontSize: 12 }}>/link {tgCode}</code> to <a href="https://t.me/PiggysentinelBot" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>@PiggysentinelBot</a>
            </p>
            <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => setStep("done")}>Done →</button>
          </div>
        )}
      </div>
    </Shell>
  );

  // ── DONE ────────────────────────────────────────────────────────────────────
  return (
    <Shell step="done">
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <div style={{ fontSize: 52, marginBottom: 10 }}>🐷</div>
        <h2 className="font-display" style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.03em", marginBottom: 6 }}>Piggy is live!</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>Your strategy is running. I check in every 6 hours.</p>
      </div>
      <div className="card" style={{ padding: "20px", marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[
            { label: "Strategy",          value: `${chosenRisk.emoji} ${chosenRisk.label}` },
            { label: "Est. annual yield", value: `+$${(amountNum * apyNum).toFixed(2)}`, accent: true },
            { label: "Contribution",      value: pattern === "recurring" ? `$${weeklyAmt}/wk` : "Manual" },
            { label: "Spending limit",    value: `$${maxPerWeek}/wk` },
          ].map(s => (
            <div key={s.label} className="card-inset" style={{ padding: "12px 14px", borderRadius: "var(--radius-md)" }}>
              <div className="stat-label" style={{ marginBottom: 4 }}>{s.label}</div>
              <div className="font-display" style={{ fontWeight: 700, fontSize: 17, color: (s as {accent?: boolean}).accent ? "var(--accent)" : "var(--text-primary)" }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>
      <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => router.push("/dashboard")}>Go to dashboard →</button>
    </Shell>
  );
}
