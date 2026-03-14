"use client";
import { usePathname, useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { ThemeToggle } from "@/components/ThemeToggle";

interface NavItem {
  href:   string;
  icon:   string;
  label:  string;
}

const NAV: NavItem[] = [
  { href: "/dashboard", icon: "◈",  label: "Dashboard"  },
  { href: "/goals",     icon: "◎",  label: "Goals"      },
  { href: "/agent",     icon: "⬡",  label: "Agent"      },
  { href: "/activity",  icon: "≡",  label: "Activity"   },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const { user, logout } = usePrivy();
  const address  = user?.wallet?.address;

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg)" }}>

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside style={{
        width:          220,
        flexShrink:     0,
        borderRight:    "1px solid var(--border-subtle)",
        display:        "flex",
        flexDirection:  "column",
        position:       "sticky",
        top:            0,
        height:         "100vh",
        background:     "var(--bg-card)",
        zIndex:         30,
      }}>

        {/* Logo */}
        <div style={{ padding: "20px 18px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
          <button
            onClick={() => router.push("/dashboard")}
            style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            <div style={{
              width: 34, height: 34, borderRadius: "var(--radius-md)",
              background: "linear-gradient(135deg, var(--accent-pale), var(--accent-light))",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18, border: "1.5px solid var(--accent-light)", flexShrink: 0,
            }}>🐷</div>
            <span className="font-display" style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
              Piggy
            </span>
          </button>
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, padding: "10px 10px" }}>
          {NAV.map(item => {
            const active = isActive(item.href);
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                style={{
                  display:        "flex",
                  alignItems:     "center",
                  gap:            10,
                  width:          "100%",
                  padding:        "10px 10px",
                  borderRadius:   "var(--radius-md)",
                  border:         "none",
                  cursor:         "pointer",
                  marginBottom:   2,
                  background:     active ? "var(--accent-pale)" : "transparent",
                  color:          active ? "var(--accent)" : "var(--text-secondary)",
                  fontFamily:     "var(--font-body)",
                  fontSize:       14,
                  fontWeight:     active ? 600 : 400,
                  textAlign:      "left",
                  transition:     "all 0.15s ease",
                  letterSpacing:  "-0.01em",
                }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-secondary)"; }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
              >
                <span style={{
                  width: 28, height: 28, display: "flex", alignItems: "center",
                  justifyContent: "center", borderRadius: "var(--radius-sm)",
                  background: active ? "var(--accent-light)" : "var(--bg-secondary)",
                  fontSize: 14, color: active ? "var(--accent)" : "var(--text-tertiary)",
                  flexShrink: 0,
                }}>
                  {item.icon}
                </span>
                {item.label}
                {active && (
                  <div style={{ marginLeft: "auto", width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
                )}
              </button>
            );
          })}

          {/* Divider */}
          <div style={{ height: 1, background: "var(--border-subtle)", margin: "10px 0" }} />

          {/* Enable Piggy CTA */}
          <button
            onClick={() => router.push("/enable")}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              width: "100%", padding: "10px 10px",
              borderRadius: "var(--radius-md)", border: "none",
              cursor: "pointer", background: "transparent",
              color: "var(--accent)", fontFamily: "var(--font-body)",
              fontSize: 14, fontWeight: 500, textAlign: "left",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--accent-pale)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
          >
            <span style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--radius-sm)", background: "var(--accent-pale)", fontSize: 14, flexShrink: 0 }}>＋</span>
            Enable Piggy
          </button>
        </nav>

        {/* Bottom: wallet + controls */}
        <div style={{ padding: "12px 10px", borderTop: "1px solid var(--border-subtle)" }}>
          {address && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--bg-secondary)", borderRadius: "var(--radius-md)", marginBottom: 8 }}>
              <div style={{ width: 20, height: 20, borderRadius: "50%", background: "linear-gradient(135deg, var(--accent-light), var(--accent))", flexShrink: 0 }} />
              <span style={{ fontSize: 11.5, fontFamily: "var(--font-mono)", color: "var(--text-secondary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {address.slice(0, 6)}…{address.slice(-4)}
              </span>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px" }}>
            <ThemeToggle />
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { logout(); router.push("/"); }}
              style={{ fontSize: 12, color: "var(--text-tertiary)" }}
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

        {/* Mobile top bar (hidden on desktop via CSS) */}
        <div className="mobile-topbar" style={{
          display: "none",
          borderBottom: "1px solid var(--border-subtle)",
          padding: "0 16px",
          height: 56,
          alignItems: "center",
          justifyContent: "space-between",
          background: "var(--bg-card)",
          position: "sticky",
          top: 0,
          zIndex: 30,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 20 }}>🐷</span>
            <span className="font-display" style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)" }}>Piggy</span>
          </div>
          <ThemeToggle />
        </div>

        {/* Page content */}
        <main style={{ flex: 1, padding: "32px max(20px, calc(50% - 640px)) 80px" }}>
          {children}
        </main>
      </div>

      {/* ── Mobile bottom nav ─────────────────────────────────────────────── */}
      <div className="mobile-nav" style={{
        display: "none",
        position: "fixed",
        bottom: 0, left: 0, right: 0,
        borderTop: "1px solid var(--border-subtle)",
        background: "var(--bg-card)",
        padding: "8px 0 max(8px, env(safe-area-inset-bottom))",
        zIndex: 30,
      }}>
        {NAV.map(item => {
          const active = isActive(item.href);
          return (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "6px 4px", background: "none", border: "none", cursor: "pointer", color: active ? "var(--accent)" : "var(--text-tertiary)" }}
            >
              <span style={{ fontSize: 17 }}>{item.icon}</span>
              <span style={{ fontSize: 10, fontWeight: active ? 600 : 400 }}>{item.label}</span>
            </button>
          );
        })}
      </div>

      <style>{`
        @media (max-width: 768px) {
          aside { display: none !important; }
          .mobile-topbar { display: flex !important; }
          .mobile-nav { display: flex !important; }
          main { padding-bottom: 80px !important; }
        }
      `}</style>
    </div>
  );
}
