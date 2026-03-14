"use client";
import { useState, useRef, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";

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

const GREETING = "Hi! I'm Penny 🐷\n\nAsk me anything about your savings, or just tell me a goal and I'll help you get started.";
const FREE_LIMIT = 10;

export function PennyBubble() {
  const { user } = usePrivy();
  const [open,      setOpen]      = useState(false);
  const [msgs,      setMsgs]      = useState<Msg[]>([{ role: "penny", text: GREETING }]);
  const [input,     setInput]     = useState("");
  const [loading,   setLoading]   = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [msgs, open]);

  async function send() {
    const txt = input.trim();
    if (!txt || loading) return;
    setInput("");
    setMsgs(p => [...p, { role: "user", text: txt }, { role: "penny", text: "...", loading: true }]);
    setLoading(true);

    try {
      const res  = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: user?.wallet?.address ?? "guest", message: txt }),
      });
      const data = await res.json() as ApiResponse;

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

  const msgCount  = msgs.filter(m => m.role === "user").length;
  const usedPct   = remaining !== null ? Math.max(0, ((FREE_LIMIT - remaining) / FREE_LIMIT) * 100) : 0;
  const nearLimit = remaining !== null && remaining <= 3 && remaining > 0;
  const atLimit   = remaining !== null && remaining === 0;

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
                    whiteSpace: "pre-wrap",
                    opacity: m.loading ? 0.7 : 1,
                    border: m.role === "penny" ? "1px solid var(--border-subtle)" : "none",
                  }}>
                    {m.loading ? (
                      <div style={{ display: "flex", gap: 4, alignItems: "center", height: 16 }}>
                        {[0,1,2].map(j => (
                          <div key={j} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-tertiary)", animation: "bounce 1.2s ease infinite", animationDelay: `${j * 0.15}s` }} />
                        ))}
                      </div>
                    ) : m.text}
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
