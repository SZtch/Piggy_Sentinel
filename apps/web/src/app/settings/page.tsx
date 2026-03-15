"use client";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { api } from "@/lib/api";

export default function SettingsPage() {
  const { ready, authenticated, user, logout } = usePrivy();
  const router  = useRouter();
  const address = user?.wallet?.address;

  const [telegramLinked,  setTelegramLinked]  = useState<boolean | null>(null);
  const [linkCode,        setLinkCode]        = useState<string | null>(null);
  const [loadingCode,     setLoadingCode]     = useState(false);
  const [codeExpiry,      setCodeExpiry]      = useState<Date | null>(null);
  const [chatUsage,       setChatUsage]       = useState<{ used: number; freeLimit: number; remaining: number } | null>(null);
  const [copied,          setCopied]          = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) { router.push("/"); return; }
    if (!address) return;
    loadStatus(address);
  }, [ready, authenticated, address]);

  async function loadStatus(addr: string) {
    try {
      const [telegramRes, chatRes] = await Promise.all([
        fetch(`/api/telegram/link-status?wallet=${encodeURIComponent(addr)}`).then(r => r.json()),
        api.getChatLimit(addr),
      ]);
      setTelegramLinked(telegramRes.linked ?? false);
      setChatUsage(chatRes);
    } catch {}
  }

  async function requestCode() {
    if (!address) return;
    setLoadingCode(true);
    setLinkCode(null);
    try {
      const res = await api.requestTelegramLink(address);
      setLinkCode(res.code);
      setCodeExpiry(new Date(Date.now() + 15 * 60 * 1000)); // 15 menit
    } catch {}
    finally { setLoadingCode(false); }
  }

  async function copyCode() {
    if (!linkCode) return;
    await navigator.clipboard.writeText(`/start ${linkCode}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const BOT_URL = process.env.NEXT_PUBLIC_TELEGRAM_BOT_URL ?? "https://t.me/PiggySentinelBot";

  return (
    <AppShell>
      <div style={{ maxWidth: 480 }}>
        <div style={{ marginBottom: 24 }}>
          <h1>Settings</h1>
        </div>

        {/* Wallet info */}
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ padding: "12px 16px 0", fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "var(--mono)" }}>
            Wallet
          </div>
          <div className="card-row" style={{ borderBottom: "none" }}>
            <span style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--mono)" }}>Address</span>
            <span style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--text)" }}>
              {address ? `${address.slice(0, 8)}…${address.slice(-6)}` : "—"}
            </span>
          </div>
        </div>

        {/* Telegram */}
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ padding: "12px 16px 0", fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "var(--mono)" }}>
            Telegram Notifications
          </div>

          <div className="card-row">
            <span style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--mono)" }}>Status</span>
            {telegramLinked === null ? (
              <span style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--text3)" }}>loading…</span>
            ) : telegramLinked ? (
              <span className="badge badge-green">✓ linked</span>
            ) : (
              <span className="badge badge-muted">not linked</span>
            )}
          </div>

          <div style={{ padding: "12px 16px", borderBottom: `1px solid var(--border)` }}>
            {telegramLinked ? (
              <p style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
                Penny akan kirim notifikasi ke Telegram kamu untuk milestone,
                rebalance, dan alert penting.
              </p>
            ) : (
              <>
                <p style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6, marginBottom: 12 }}>
                  Link Telegram untuk dapat notifikasi otomatis dari Penny —
                  milestone, rebalance, circuit breaker, dan lainnya.
                </p>

                {!linkCode ? (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={requestCode}
                    disabled={loadingCode}
                  >
                    {loadingCode ? "Generating…" : "Generate link code"}
                  </button>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {/* Step 1 */}
                    <div style={{ background: "var(--bg3)", border: `1px solid var(--border)`, borderRadius: 6, padding: "12px 14px" }}>
                      <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--mono)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        Step 1 — Buka bot
                      </div>
                      <a
                        href={BOT_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-primary btn-sm"
                        style={{ display: "inline-flex", textDecoration: "none" }}
                      >
                        Buka @PiggySentinelBot →
                      </a>
                    </div>

                    {/* Step 2 */}
                    <div style={{ background: "var(--bg3)", border: `1px solid var(--border)`, borderRadius: 6, padding: "12px 14px" }}>
                      <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--mono)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        Step 2 — Kirim kode ini ke bot
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{
                          flex: 1, background: "var(--bg2)",
                          border: `1px solid var(--border)`, borderRadius: 5,
                          padding: "8px 12px", fontFamily: "var(--mono)",
                          fontSize: 15, fontWeight: 600, color: "var(--green)",
                          letterSpacing: "0.1em",
                        }}>
                          /start {linkCode}
                        </div>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={copyCode}
                          style={{ flexShrink: 0 }}
                        >
                          {copied ? "✓ Copied" : "Copy"}
                        </button>
                      </div>
                      {codeExpiry && (
                        <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--mono)", marginTop: 6 }}>
                          Kode berlaku 15 menit
                        </div>
                      )}
                    </div>

                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => { setLinkCode(null); loadStatus(address!); }}
                    >
                      ↻ Cek status setelah link
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Notification types */}
          <div style={{ padding: "12px 16px" }}>
            <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--mono)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Notifikasi yang dikirim
            </div>
            {[
              { icon: "🎉", label: "Goal completed" },
              { icon: "⚖️", label: "Portfolio rebalanced" },
              { icon: "🚨", label: "Circuit breaker tripped" },
              { icon: "⚠️", label: "Action required (allowance, balance)" },
              { icon: "⏰", label: "Goal expired" },
            ].map(n => (
              <div key={n.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, fontSize: 12, color: "var(--text2)" }}>
                <span style={{ fontSize: 13 }}>{n.icon}</span>
                {n.label}
              </div>
            ))}
          </div>
        </div>

        {/* Chat usage */}
        {chatUsage && (
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ padding: "12px 16px 0", fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "var(--mono)" }}>
              Penny Chat Usage
            </div>
            <div className="card-row">
              <span style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--mono)" }}>Free messages used</span>
              <span style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--text)" }}>
                {chatUsage.used} / {chatUsage.freeLimit}
              </span>
            </div>
            <div className="card-row" style={{ borderBottom: "none" }}>
              <span style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--mono)" }}>Remaining this month</span>
              <span style={{ fontSize: 12, fontFamily: "var(--mono)", color: chatUsage.remaining > 0 ? "var(--green)" : "var(--amber)" }}>
                {chatUsage.remaining > 0 ? `${chatUsage.remaining} free` : "0.01 USDC / message"}
              </span>
            </div>
            {/* Usage bar */}
            <div style={{ padding: "0 16px 12px" }}>
              <div className="progress-track">
                <div className="progress-fill" style={{
                  width: `${(chatUsage.used / chatUsage.freeLimit) * 100}%`,
                  background: chatUsage.remaining === 0 ? "var(--amber)" : "var(--green)",
                }} />
              </div>
            </div>
          </div>
        )}

        {/* Sign out */}
        <div className="card">
          <div className="card-row" style={{ borderBottom: "none" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", marginBottom: 2 }}>Sign out</div>
              <div style={{ fontSize: 11, color: "var(--text3)" }}>Disconnect wallet dari app</div>
            </div>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => { logout(); router.push("/"); }}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
