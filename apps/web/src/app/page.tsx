"use client";
import { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";

const STATS = [
  { label: "Total Yield Generated", value: 284192, prefix: "$", decimals: 0 },
  { label: "Active Savers",         value: 1847,   prefix: "",  decimals: 0 },
  { label: "Average APY",           value: 6.22,   prefix: "",  suffix: "%", decimals: 2 },
  { label: "Goals Completed",       value: 412,    prefix: "",  decimals: 0 },
];

const STEPS = [
  { n: "01", title: "Tell Penny your goal", body: 'Say it plainly — "Save $5,000 for a new car by December." No forms, no spreadsheets.' },
  { n: "02", title: "Approve once",         body: "One wallet signature lets Penny manage funds within the exact limit you set. Nothing more, ever." },
  { n: "03", title: "Sit back",             body: "Penny allocates, monitors every 6 hours, and rebalances. You get Telegram pings on milestones." },
];

const FEATURES = [
  { icon: "🧠", title: "AI-Powered Strategy",  body: "Penny understands your goal and timeline, then builds a DeFi strategy tailored to your risk comfort. No spreadsheets." },
  { icon: "⚡", title: "Fully Automated",       body: "Markets get checked every 6 hours. When a better allocation exists, Penny moves. You do nothing." },
  { icon: "🔒", title: "Non-Custodial",         body: "Funds live in your own wallet at all times. Penny can only act within the spend limit you pre-approve." },
  { icon: "📱", title: "Telegram Updates",      body: "Milestone alerts, strategy changes, goal completion — all delivered to you in plain English." },
];

function useCountUp(target: number, decimals = 0, started: boolean) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!started) return;
    let raf: number;
    const start = performance.now();
    const duration = 1800;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      setValue(target * ease(p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, started]);
  return decimals === 0 ? Math.round(value).toLocaleString() : value.toFixed(decimals);
}

function StatBlock({ label, value, prefix = "", suffix = "", decimals = 0, started }: {
  label: string; value: number; prefix?: string; suffix?: string; decimals?: number; started: boolean;
}) {
  const display = useCountUp(value, decimals, started);
  return (
    <div style={{ textAlign: "center" }}>
      <div className="font-display" style={{ fontSize: "clamp(28px,4vw,40px)", fontWeight: 700, letterSpacing: "-0.03em", color: "var(--accent)", lineHeight: 1.1 }}>
        {prefix}{display}{suffix}
      </div>
      <div className="stat-label" style={{ marginTop: 6 }}>{label}</div>
    </div>
  );
}

// Animated pig coin graphic for hero
function HeroCard() {
  return (
    <div className="animate-float" style={{ animationDelay: "0.5s" }}>
      <div className="card" style={{ padding: 28, width: 340, boxShadow: "var(--shadow-xl)", border: "1px solid var(--border)" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: "linear-gradient(135deg, var(--accent-pale), var(--accent-light))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, border: "2px solid var(--accent-light)" }}>🐷</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>Penny</div>
            <div style={{ fontSize: 12, color: "var(--accent)", display: "flex", alignItems: "center", gap: 4 }}>
              <span className="live-dot" />
              Managing your savings
            </div>
          </div>
          <div className="badge badge-green">On Track</div>
        </div>

        {/* Progress */}
        <div style={{ marginBottom: 18 }}>
          <div className="stat-label" style={{ marginBottom: 6 }}>Goal Progress</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <span className="font-display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", color: "var(--text-primary)" }}>$1,247</span>
            <span style={{ fontSize: 13, color: "var(--text-tertiary)" }}>of $2,000</span>
          </div>
          <div className="progress-track" style={{ height: 8 }}>
            <div className="progress-fill" style={{ width: "62.35%" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            {[25,50,75,100].map(m => (
              <div key={m} style={{ fontSize: 10, color: 62.35 >= m ? "var(--accent)" : "var(--text-tertiary)", fontWeight: 62.35 >= m ? 600 : 400 }}>
                {62.35 >= m ? "✓" : "·"} {m}%
              </div>
            ))}
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[
            { label: "Current APY", value: "6.22%", accent: true },
            { label: "Yield Earned", value: "+$34.18", accent: true },
          ].map(s => (
            <div key={s.label} style={{ background: s.accent ? "var(--accent-pale)" : "var(--bg-secondary)", borderRadius: "var(--radius-md)", padding: "12px 14px", border: s.accent ? "1px solid var(--accent-light)" : "none" }}>
              <div className="stat-label" style={{ marginBottom: 4 }}>{s.label}</div>
              <div className="font-display" style={{ fontWeight: 700, fontSize: 20, color: s.accent ? "var(--accent)" : "var(--text-primary)" }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Next action */}
        <div style={{ marginTop: 14, padding: "10px 12px", background: "var(--bg-secondary)", borderRadius: "var(--radius-md)", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)" }}>
          <span>⏱</span> Next rebalance in 2h 14m
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();
  const statsRef = useRef<HTMLDivElement>(null);
  const [statsStarted, setStatsStarted] = useState(false);

  useEffect(() => {
    if (authenticated) router.push("/dashboard");
  }, [authenticated]);

  useEffect(() => {
    const el = statsRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setStatsStarted(true); obs.disconnect(); } }, { threshold: 0.3 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  if (authenticated) return null;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", position: "relative", overflow: "hidden" }}>

      {/* Subtle dot grid background */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)",
        backgroundSize: "28px 28px",
        opacity: 0.5,
      }} />

      {/* Warm gradient blob */}
      <div style={{ position: "fixed", top: "-20%", right: "-10%", width: "60vw", height: "60vw", maxWidth: 800, maxHeight: 800, borderRadius: "50%", background: "radial-gradient(circle, rgba(10,107,75,0.07) 0%, transparent 70%)", zIndex: 0, pointerEvents: "none" }} />

      <div style={{ position: "relative", zIndex: 1 }}>
        {/* Nav */}
        <nav style={{
          position: "sticky", top: 0, zIndex: 40,
          borderBottom: "1px solid var(--border-subtle)",
          backdropFilter: "blur(16px)",
          background: "color-mix(in srgb, var(--bg) 80%, transparent)",
          padding: "0 max(24px, calc(50% - 620px))",
          height: 64,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 24 }}>🐷</span>
            <span className="font-display" style={{ fontWeight: 700, fontSize: 17, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
              Piggy Sentinel
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={login} disabled={!ready}>
              Get started
            </button>
          </div>
        </nav>

        {/* Hero */}
        <section style={{ padding: "100px max(24px, calc(50% - 620px)) 80px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 60, alignItems: "center", maxWidth: "100%" }}>

            {/* Left: copy */}
            <div style={{ maxWidth: 520 }}>
              <div className="badge badge-green animate-fade-in" style={{ marginBottom: 28, fontSize: 12 }}>
                <span className="live-dot" /> Powered by Celo · Non-custodial DeFi
              </div>

              <h1 className="font-display animate-fade-up" style={{ fontSize: "clamp(44px, 6vw, 72px)", fontWeight: 800, color: "var(--text-primary)", lineHeight: 1.06, letterSpacing: "-0.04em", marginBottom: 20 }}>
                Your money,<br />
                <span style={{ color: "var(--accent)" }}>working harder.</span>
              </h1>

              <p className="animate-fade-up delay-100" style={{ fontSize: "clamp(16px, 1.8vw, 19px)", color: "var(--text-secondary)", lineHeight: 1.65, marginBottom: 36 }}>
                Tell Penny your savings goal. She builds a personalized DeFi strategy and manages it automatically — while your funds stay in your own wallet.
              </p>

              <div className="animate-fade-up delay-200" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button className="btn btn-primary btn-lg" onClick={login} disabled={!ready}>
                  Start with Penny 🐷
                </button>
                <a href="#how" className="btn btn-secondary btn-lg">
                  How it works →
                </a>
              </div>

              <div className="animate-fade-up delay-300" style={{ display: "flex", gap: 24, marginTop: 32, flexWrap: "wrap" }}>
                {["Funds stay in your wallet", "Pause or cancel anytime", "No DeFi knowledge needed"].map(t => (
                  <div key={t} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-secondary)" }}>
                    <span style={{ color: "var(--accent)", fontWeight: 700 }}>✓</span> {t}
                  </div>
                ))}
              </div>
            </div>

            {/* Right: floating hero card */}
            <div className="animate-fade-in delay-400" style={{ display: "flex", justifyContent: "center" }}>
              <HeroCard />
            </div>
          </div>
        </section>

        {/* Stats bar */}
        <section ref={statsRef} style={{ borderTop: "1px solid var(--border-subtle)", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-card)" }}>
          <div style={{ padding: "44px max(24px, calc(50% - 620px))", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 32 }}>
            {STATS.map((s, i) => (
              <div key={s.label} className={`animate-fade-up delay-${i * 100}`}>
                <StatBlock {...s} started={statsStarted} />
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how" style={{ padding: "96px max(24px, calc(50% - 620px))" }}>
          <div style={{ textAlign: "center", marginBottom: 60 }}>
            <div className="badge badge-neutral" style={{ marginBottom: 16, fontSize: 12 }}>How it works</div>
            <h2 className="font-display" style={{ fontSize: "clamp(28px,4vw,46px)", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.03em", lineHeight: 1.1 }}>
              Zero to automated<br />in three steps.
            </h2>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, maxWidth: 860, margin: "0 auto" }}>
            {STEPS.map((s, i) => (
              <div key={s.n} className={`card animate-fade-up delay-${i * 100 + 100}`} style={{ padding: "30px 26px", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 16, right: 20, fontFamily: "var(--font-display)", fontSize: 56, fontWeight: 800, color: "var(--border)", lineHeight: 1, userSelect: "none" }}>{s.n}</div>
                <div style={{ position: "relative", zIndex: 1 }}>
                  <div style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", background: "var(--accent-pale)", border: "1.5px solid var(--accent-light)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--accent)" }} />
                  </div>
                  <h3 className="font-display" style={{ fontWeight: 600, fontSize: 17, color: "var(--text-primary)", marginBottom: 10, lineHeight: 1.3 }}>{s.title}</h3>
                  <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.65 }}>{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Features bento */}
        <section style={{ padding: "0 max(24px, calc(50% - 620px)) 96px" }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-2xl)", overflow: "hidden" }}>
            <div style={{ padding: "40px 40px 32px", borderBottom: "1px solid var(--border-subtle)" }}>
              <div className="badge badge-neutral" style={{ marginBottom: 12, fontSize: 12 }}>Why Piggy Sentinel</div>
              <h2 className="font-display" style={{ fontSize: "clamp(22px,3vw,34px)", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.03em" }}>Built differently.</h2>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              {FEATURES.map((f, i) => (
                <div key={f.title} className={`animate-fade-up delay-${i * 100}`} style={{ padding: "28px 32px", borderRight: i < FEATURES.length - 1 ? "1px solid var(--border-subtle)" : "none", borderBottom: "none" }}>
                  <span style={{ fontSize: 26, display: "block", marginBottom: 16 }}>{f.icon}</span>
                  <h3 className="font-display" style={{ fontWeight: 600, fontSize: 15, color: "var(--text-primary)", marginBottom: 10, letterSpacing: "-0.01em" }}>{f.title}</h3>
                  <p style={{ color: "var(--text-secondary)", fontSize: 13.5, lineHeight: 1.65 }}>{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section style={{ padding: "0 max(24px, calc(50% - 620px)) 96px" }}>
          <div style={{ background: "linear-gradient(135deg, var(--accent) 0%, var(--accent-mid) 100%)", borderRadius: "var(--radius-2xl)", padding: "72px 48px", textAlign: "center", boxShadow: "var(--shadow-xl)", position: "relative", overflow: "hidden" }}>
            {/* Background decoration */}
            <div style={{ position: "absolute", top: "-30%", right: "-10%", width: 400, height: 400, borderRadius: "50%", background: "rgba(255,255,255,0.05)", pointerEvents: "none" }} />
            <div style={{ position: "absolute", bottom: "-20%", left: "-5%", width: 280, height: 280, borderRadius: "50%", background: "rgba(255,255,255,0.04)", pointerEvents: "none" }} />

            <div style={{ position: "relative", zIndex: 1 }}>
              <div style={{ fontSize: 48, marginBottom: 20 }}>🐷</div>
              <h2 className="font-display animate-fade-up" style={{ fontSize: "clamp(28px,4vw,48px)", fontWeight: 800, letterSpacing: "-0.04em", color: "#fff", marginBottom: 16, lineHeight: 1.1 }}>
                Ready to start saving?
              </h2>
              <p className="animate-fade-up delay-100" style={{ color: "rgba(255,255,255,0.78)", marginBottom: 36, fontSize: 17, maxWidth: 440, margin: "0 auto 36px" }}>
                No DeFi expertise needed. Just tell Penny what you want — she handles everything else.
              </p>
              <button
                className="btn btn-xl animate-fade-up delay-200"
                onClick={login}
                disabled={!ready}
                style={{ background: "#fff", color: "var(--accent)", fontWeight: 700, boxShadow: "0 8px 24px rgba(0,0,0,0.2)" }}
              >
                Start with Penny 🐷
              </button>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer style={{ borderTop: "1px solid var(--border-subtle)", padding: "24px max(24px, calc(50% - 620px))", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>🐷</span>
            <span style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Piggy Sentinel · Built on Celo</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: process.env.NEXT_PUBLIC_APP_ENV === "prod" ? "var(--accent)" : "var(--amber)", display: "inline-block" }} />
            {process.env.NEXT_PUBLIC_APP_ENV === "prod" ? "Mainnet" : "Celo Sepolia Testnet"}
          </div>
        </footer>
      </div>
    </div>
  );
}
