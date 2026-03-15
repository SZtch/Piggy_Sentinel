"use client";
import { useState, useRef, useEffect } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom, parseUnits, type Address } from "viem";
import { celo } from "viem/chains";
import { defineChain } from "viem";

const celoSepolia = defineChain({
  id: 11142220, name: "Celo Sepolia",
  nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
  rpcUrls: { default: { http: ["https://forno.celo-sepolia.celo.org"] } },
  testnet: true,
});

const IS_MAINNET = process.env.NEXT_PUBLIC_APP_ENV === "prod";
const CHAIN      = IS_MAINNET ? celo : celoSepolia;

// ERC20 transfer ABI
const ERC20_TRANSFER_ABI = [{
  name: "transfer", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ type: "bool" }],
}] as const;

interface Msg {
  role: "penny" | "user";
  text: string;
  loading?: boolean;
  usageFooter?: string | null;
}

interface ApiResponse {
  answer:       string;
  usageFooter?: string | null;
  remaining?:   number;
  freeLimit?:   number;
  isPaid?:      boolean;
}

interface X402Info {
  asset:  string;
  payTo:  string;
  amount: string;
}

const FREE_LIMIT = 10;

export function PennyBubble() {
  const { user, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const [open,      setOpen]      = useState(false);
  const [msgs,         setMsgs]         = useState<Msg[]>([]);
  const [greetingLoaded, setGreetingLoaded] = useState(false);
  const [input,     setInput]     = useState("");
  const [loading,   setLoading]   = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [x402Info,  setX402Info]  = useState<X402Info | null>(null);
  const [paying,    setPaying]    = useState(false);
  const [pendingMsg, setPendingMsg] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  // Fetch contextual greeting pertama kali bubble dibuka
  useEffect(() => {
    if (!open || greetingLoaded || !user?.wallet?.address) return;
    setGreetingLoaded(true);

    const wallet = user.wallet.address;

    // Tampilkan typing indicator dulu
    setMsgs([{ role: "penny", text: "...", loading: true }]);

    fetch("/api/goals/status?wallet=" + encodeURIComponent(wallet))
      .then(r => r.json())
      .then(async (g: any) => {
        const hasGoal = g && g.status !== "no_active_goal";

        if (!hasGoal) {
          // User belum punya goal
          setMsgs([{
            role: "penny",
            text: "Hei! Aku Penny 🐷\n\nKamu belum punya goal nabung nih. Yuk mulai — klik **Set up a goal** di dashboard, 2 menit aja.",
          }]);
          return;
        }

        const progress   = g.progressPct ? parseFloat(g.progressPct) : 0;
        const target     = g.targetAmount ? Number(g.targetAmount) / 1e18 : 0;
        const current    = target * (progress / 100);
        const yieldEarned = g.yieldEarned ? Number(g.yieldEarned) / 1e18 : 0;
        const deadline   = new Date(g.deadline);
        const daysLeft   = Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);
        const isPaused   = g.soft_paused;
        const isComplete = progress >= 100;

        // Build contextual greeting
        let greeting = "";

        if (isComplete) {
          greeting = `🎉 Yeay, goal kamu tercapai!\n\nTarget **$${target.toFixed(0)} USDm** udah terpenuhi. Mau tarik dana atau lanjut nabung?`;
        } else if (isPaused) {
          greeting = `Nabung kamu lagi di-pause ⏸\n\nTenang, semua dana aman kok. Kapan mau lanjut?`;
        } else if (daysLeft <= 7 && progress < 80) {
          greeting = `Deadline tinggal **${daysLeft} hari** lagi nih 😬\n\nBaru ${progress.toFixed(0)}% dari **$${target.toFixed(0)}**. Kayaknya perlu tambah sedikit buat ngejar.`;
        } else if (progress >= 75) {
          greeting = `Udah **${progress.toFixed(0)}%**, hampir sampai! 📈\n\nYield terkumpul: **+$${yieldEarned.toFixed(2)}**. Tinggal ${daysLeft} hari 🐷`;
        } else if (yieldEarned > 0) {
          greeting = `Dana kamu udah tumbuh **+$${yieldEarned.toFixed(2)}** dari yield 🐷\n\nProgress ${progress.toFixed(0)}% dari **$${target.toFixed(0)}**, ${daysLeft} hari lagi.`;
        } else {
          greeting = `Dana kamu lagi kerja keras nih 🐷\n\nSudah **${progress.toFixed(0)}%** dari **$${target.toFixed(0)}**, ${daysLeft} hari lagi. Ada yang mau ditanyain?`;
        }

        setMsgs([{ role: "penny", text: greeting }]);
      })
      .catch(() => {
        setMsgs([{
          role: "penny",
          text: "Hei! Aku Penny 🐷 Ada yang bisa aku bantu?",
        }]);
      });
  }, [open, greetingLoaded, user?.wallet?.address]);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [msgs, open]);

  async function send(paymentHeader?: string) {
    const txt = paymentHeader ? (pendingMsg ?? "") : input.trim();
    if (!txt || loading) return;

    if (!paymentHeader) {
      setInput("");
      setPendingMsg(txt);
      setMsgs(p => [...p, { role: "user", text: txt }, { role: "penny", text: "...", loading: true }]);
    } else {
      setMsgs(p => [...p, { role: "penny", text: "...", loading: true }]);
    }
    setLoading(true);
    setX402Info(null);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (paymentHeader) headers["x-payment"] = paymentHeader;

      const res  = await fetch("/api/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({ wallet: user?.wallet?.address ?? "guest", message: txt }),
      });

      // ── 402: Payment Required ──────────────────────────────────────────
      if (res.status === 402) {
        const data = await res.json();
        setMsgs(p => p.filter(m => !m.loading));
        setX402Info(data.x402 ?? { asset: "", payTo: "", amount: "0.01" });
        setLoading(false);
        return;
      }

      const data = await res.json() as ApiResponse;
      setPendingMsg(null);

      setMsgs(p => [
        ...p.filter(m => !m.loading),
        {
          role: "penny",
          text: data.answer ?? "Something went wrong.",
          usageFooter: data.usageFooter ?? null,
        },
      ]);

      if (typeof data.remaining === "number") setRemaining(data.remaining);
    } catch {
      setMsgs(p => [...p.filter(m => !m.loading), { role: "penny", text: "Connection error. Please try again." }]);
    } finally {
      setLoading(false);
    }
  }

  async function payAndSend() {
    if (!x402Info || !wallets[0] || !user?.wallet?.address) return;
    setPaying(true);
    try {
      const provider = await wallets[0].getEthereumProvider();
      const client   = createWalletClient({
        account:   user.wallet.address as Address,
        chain:     CHAIN,
        transport: custom(provider),
      });

      // Kirim 0.01 USDC ke treasury
      const txHash = await client.writeContract({
        address:      x402Info.asset as Address,
        abi:          ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args:         [x402Info.payTo as Address, parseUnits(x402Info.amount, 6)],
      });

      // Kirim ulang pesan dengan payment header
      const paymentHeader = `${txHash}:${user.wallet.address}`;
      setX402Info(null);
      await send(paymentHeader);
    } catch (err) {
      setMsgs(p => [...p, { role: "penny", text: "Payment failed. Please try again." }]);
    } finally {
      setPaying(false);
    }
  }

  const usedPct   = remaining !== null ? Math.max(0, ((FREE_LIMIT - remaining) / FREE_LIMIT) * 100) : 0;
  const nearLimit = remaining !== null && remaining <= 3 && remaining > 0;
  const atLimit   = remaining !== null && remaining === 0;

  // Render text dengan support **bold** sederhana
  function renderText(text: string) {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return (
      <span>
        {parts.map((part, i) =>
          part.startsWith("**") && part.endsWith("**")
            ? <strong key={i} style={{ fontWeight: 600 }}>{part.slice(2, -2)}</strong>
            : <span key={i} style={{ whiteSpace: "pre-wrap" }}>{part}</span>
        )}
      </span>
    );
  }

  if (!authenticated) return null;

  return (
    <div className="penny-bubble">
      {open && (
        <div className="penny-panel" style={{ background: "var(--bg-card)" }}>

          {/* Header */}
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: 10, background: "var(--bg-card)" }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, var(--accent-pale), var(--accent-light))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, border: "2px solid var(--accent-light)", flexShrink: 0 }}>
              🐷
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, color: "var(--text-primary)" }}>Penny</div>
              <div style={{ fontSize: 11, color: "var(--accent)", display: "flex", alignItems: "center", gap: 4 }}>
                <span className="live-dot" style={{ width: 5, height: 5 }} />
                Online · Your savings agent
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="btn btn-ghost btn-sm" style={{ padding: "4px 8px", fontSize: 16 }}>✕</button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "14px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
            {msgs.map((m, i) => (
              <div key={i}>
                <div style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", gap: 6, alignItems: "flex-end" }}>
                  {m.role === "penny" && (
                    <span style={{ fontSize: 16, flexShrink: 0, marginBottom: 2 }}>🐷</span>
                  )}
                  <div style={{
                    maxWidth: "80%",
                    padding: "10px 14px",
                    borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                    background: m.role === "user" ? "var(--accent)" : "var(--bg-secondary)",
                    color: m.role === "user" ? "#fff" : "var(--text-primary)",
                    fontSize: 13.5,
                    lineHeight: 1.5,
                    opacity: m.loading ? 0.7 : 1,
                    border: m.role === "penny" ? "1px solid var(--border-subtle)" : "none",
                  }}>
                    {m.loading ? (
                      <div style={{ display: "flex", gap: 4, alignItems: "center", height: 16 }}>
                        {[0,1,2].map(j => (
                          <div key={j} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-tertiary)", animation: "bounce 1.2s ease infinite", animationDelay: `${j * 0.15}s` }} />
                        ))}
                      </div>
                    ) : renderText(m.text)}
                  </div>
                </div>

                {/* Usage footer beneath Penny's message */}
                {m.usageFooter && (
                  <div style={{ marginLeft: 28, marginTop: 4, fontSize: 11, color: "var(--text-tertiary)", fontStyle: "italic" }}>
                    {m.usageFooter.replace(/_/g, "")}
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Usage bar (shown when near limit) */}
          {remaining !== null && (
            <div style={{ padding: "6px 14px 2px", background: "var(--bg-card)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: nearLimit || atLimit ? "var(--amber)" : "var(--text-tertiary)", marginBottom: 3 }}>
                <span>{atLimit ? "Free messages used" : `${remaining} free message${remaining !== 1 ? "s" : ""} left`}</span>
                <span>{FREE_LIMIT - (remaining ?? FREE_LIMIT)}/{FREE_LIMIT}</span>
              </div>
              <div style={{ height: 2, background: "var(--bg-secondary)", borderRadius: "var(--radius-full)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: "var(--radius-full)", width: `${usedPct}%`, background: atLimit ? "var(--red)" : nearLimit ? "var(--amber)" : "var(--accent)", transition: "width 0.4s ease" }} />
              </div>
            </div>
          )}

          {/* x402 Payment gate */}
          {x402Info && (
            <div style={{ margin: "0 12px 10px", background: "var(--bg-secondary)", border: "1.5px solid var(--amber)", borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--amber)", marginBottom: 4 }}>
                💳 10 free messages used
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10, lineHeight: 1.5 }}>
                Continue chatting for <strong>0.01 USDC</strong> per message — paid directly from your wallet.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={payAndSend}
                  disabled={paying}
                  className="btn btn-primary btn-sm"
                  style={{ flex: 1 }}
                >
                  {paying ? "Paying…" : "Pay 0.01 USDC & send →"}
                </button>
                <button
                  onClick={() => { setX402Info(null); setPendingMsg(null); }}
                  className="btn btn-ghost btn-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Input area */}
          <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border-subtle)", display: "flex", gap: 8, background: "var(--bg-card)" }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
              placeholder="Ask Penny anything…"
              className="input"
              style={{ fontSize: 13, padding: "9px 13px" }}
            />
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              className="btn btn-primary btn-sm"
              style={{ flexShrink: 0, padding: "9px 14px" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      <button
        className={`penny-toggle ${open ? "open" : ""}`}
        onClick={() => setOpen(o => !o)}
        aria-label="Chat with Penny"
        title="Chat with Penny"
      >
        {open ? "✕" : "🐷"}
      </button>

      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30%            { transform: translateY(-5px); }
        }
      `}</style>
    </div>
  );
}
