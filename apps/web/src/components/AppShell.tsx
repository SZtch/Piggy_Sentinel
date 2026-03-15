"use client";
import { usePathname, useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/goals",     label: "Goals"     },
  { href: "/agent",     label: "Agent"     },
  { href: "/activity",  label: "Activity"  },
  { href: "/settings",  label: "Settings"  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const { user, logout } = usePrivy();
  const addr = user?.wallet?.address;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>

      {/* ── Top navbar ────────────────────────────────────────────────── */}
      <header style={{
        position: "sticky", top: 0, zIndex: 50,
        borderBottom: "1px solid var(--border)",
        background: "var(--bg)",
        height: 48,
        display: "flex", alignItems: "center",
        padding: "0 24px",
        gap: 0,
      }}>
        {/* Logo */}
        <button onClick={() => router.push("/dashboard")} style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "none", border: "none", cursor: "pointer",
          padding: "0 16px 0 0",
          borderRight: "1px solid var(--border)",
          marginRight: 16, height: "100%",
        }}>
          <span style={{ fontSize: 16 }}>🐷</span>
          <span style={{
            fontFamily: "var(--mono)", fontSize: 13, fontWeight: 600,
            color: "var(--text)", letterSpacing: "-0.01em",
          }}>
            piggy<span style={{ color: "var(--green)" }}>.</span>sentinel
          </span>
        </button>

        {/* Nav links */}
        <nav style={{ display: "flex", alignItems: "center", gap: 2, flex: 1 }}>
          {NAV.map(item => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <button key={item.href} onClick={() => router.push(item.href)} style={{
                background: "none", border: "none", cursor: "pointer",
                padding: "6px 12px", borderRadius: 6,
                fontSize: 13, fontWeight: active ? 500 : 400,
                color: active ? "var(--text)" : "var(--text2)",
                background: active ? "var(--bg3)" : "transparent",
                transition: "all 0.15s",
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = "var(--text)"; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = "var(--text2)"; }}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Right: wallet + actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => router.push("/enable")}
            className="btn btn-primary btn-sm"
          >
            + New goal
          </button>
          {addr && (
            <button onClick={() => { logout(); router.push("/"); }} style={{
              background: "var(--bg3)",
              border: "1px solid var(--border)",
              borderRadius: 6, padding: "5px 10px",
              fontSize: 12, fontFamily: "var(--mono)",
              color: "var(--text2)", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: "var(--green)",
                display: "inline-block",
              }} />
              {addr.slice(0, 6)}…{addr.slice(-4)}
            </button>
          )}
        </div>
      </header>

      {/* ── Content ───────────────────────────────────────────────────── */}
      <main style={{ padding: "28px 24px", maxWidth: 1024, margin: "0 auto" }}>
        {children}
      </main>
      {/* ── Mobile bottom nav ─────────────────────────────────────────── */}
      <div className="mobile-bottom-nav">
        {NAV.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <button key={item.href} onClick={() => router.push(item.href)} style={{
              color: active ? "var(--green)" : "var(--text3)",
            }}>
              <span>{
                item.label === "Dashboard" ? "⬡" :
                item.label === "Goals"     ? "◎" :
                item.label === "Agent"     ? "⬡" : "≡"
              }</span>
              <span style={{ color: active ? "var(--green)" : "var(--text3)" }}>
                {item.label}
              </span>
            </button>
          );
        })}
        <button onClick={() => router.push("/enable")} style={{ color: "var(--green)" }}>
          <span>＋</span>
          <span style={{ color: "var(--green)" }}>New</span>
        </button>
      </div>
    </div>
  );
}
