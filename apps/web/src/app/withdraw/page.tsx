"use client";
import { useState, useEffect } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import {
  createWalletClient, createPublicClient,
  custom, http, type Address,
} from "viem";
import { celo } from "viem/chains";
import { defineChain } from "viem";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { api, type GoalData } from "@/lib/api";

const celoSepolia = defineChain({
  id: 11142220, name: "Celo Sepolia",
  nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
  rpcUrls: { default: { http: ["https://forno.celo-sepolia.celo.org"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://celo-sepolia.blockscout.com" } },
  testnet: true,
});
const IS_MAINNET  = process.env.NEXT_PUBLIC_APP_ENV === "prod";
const CHAIN       = IS_MAINNET ? celo : celoSepolia;
const RPC_URL     = IS_MAINNET ? "https://forno.celo.org" : "https://forno.celo-sepolia.celo.org";
const EXPLORER    = IS_MAINNET ? "https://celo.blockscout.com/tx/" : "https://celo-sepolia.blockscout.com/tx/";

const EXECUTOR = process.env.NEXT_PUBLIC_SENTINEL_EXECUTOR_ADDRESS as Address;
const A_USDC   = process.env.NEXT_PUBLIC_A_USDC_ADDRESS as Address;
const A_USDT   = process.env.NEXT_PUBLIC_A_USDT_ADDRESS as Address;
const A_USDM   = process.env.NEXT_PUBLIC_A_USDM_ADDRESS as Address;
const USDC     = process.env.NEXT_PUBLIC_USDC_ADDRESS   as Address;
const USDT     = process.env.NEXT_PUBLIC_USDT_ADDRESS   as Address;
const USDM     = process.env.NEXT_PUBLIC_USDM_ADDRESS   as Address;

const WITHDRAW_ABI = [{
  name: "withdraw", type: "function", stateMutability: "nonpayable",
  inputs: [
    { name: "aaveAssets", type: "address[]" },
  ],
  outputs: [],
}] as const;

// ABI untuk baca per-user aToken shares dari kontrak
const USER_ATOKENSHARES_ABI = [{
  name: "userATokenShares", type: "function", stateMutability: "view",
  inputs: [
    { name: "user",  type: "address" },
    { name: "asset", type: "address" },
  ],
  outputs: [{ type: "uint256" }],
}] as const;


const BALANCE_ABI = [{
  name: "balanceOf", type: "function", stateMutability: "view",
  inputs:  [{ name: "account", type: "address" }],
  outputs: [{ type: "uint256" }],
}] as const;

type Stage = "review" | "confirm" | "executing" | "done";

export default function WithdrawPage() {
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const router  = useRouter();
  const address = user?.wallet?.address as Address | undefined;

  const [goal,       setGoal]       = useState<GoalData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [stage,      setStage]      = useState<Stage>("review");
  const [error,      setError]      = useState<string | null>(null);
  const [txHash,     setTxHash]     = useState<string | null>(null);
  const [aPositions, setAPositions] = useState<{ label: string; asset: Address; balance: bigint }[]>([]);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) { router.push("/"); return; }
    if (!address) return;
    api.getGoalStatus(address)
      .then(g => {
        const gd = g as GoalData;
        if (!gd?.id || (gd as { status?: string }).status === "no_active_goal") {
          router.push("/dashboard"); return;
        }
        setGoal(gd);
        loadAavePositions();
      })
      .catch(() => router.push("/dashboard"))
      .finally(() => setLoading(false));
  }, [ready, authenticated, address]);

  async function loadAavePositions() {
    if (!EXECUTOR || EXECUTOR.includes("_ISI_") || !address) return;
    try {
      const client = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });
      const assets = [
        { label: "USDT (Aave)", asset: USDT },
        { label: "USDC (Aave)", asset: USDC },
        { label: "USDm (Aave)", asset: USDM },
      ].filter(p => p.asset);

      // Baca userATokenShares[userWallet][asset] — per-user balance, bukan pooled
      const results = await Promise.all(assets.map(async p => {
        try {
          const shares = await client.readContract({
            address: EXECUTOR,
            abi: USER_ATOKENSHARES_ABI,
            functionName: "userATokenShares",
            args: [address, p.asset],
          });
          return { label: p.label, asset: p.asset, balance: shares };
        } catch { return { label: p.label, asset: p.asset, balance: 0n }; }
      }));
      setAPositions(results.filter(p => p.balance > 0n));
    } catch (e) { console.warn("loadAavePositions:", e); }
  }

  async function executeWithdraw() {
    if (!goal || !wallets[0] || !address) { setError("Wallet not ready"); return; }
    if (!EXECUTOR || EXECUTOR.includes("_ISI_")) {
      setError("Executor contract not configured. Set NEXT_PUBLIC_SENTINEL_EXECUTOR_ADDRESS.");
      return;
    }
    setStage("executing"); setError(null);
    try {
      const provider = await wallets[0].getEthereumProvider();
      const client   = createWalletClient({ account: address, chain: CHAIN, transport: custom(provider) });

      // Pass semua 3 stable assets — kontrak skip yang sharesnya 0
      const assets: Address[] = [USDT, USDC, USDM].filter(Boolean) as Address[];

      // User calls SentinelExecutor.withdraw([assets]) — no amounts needed
      // Kontrak otomatis tarik semua dari userATokenShares
      const hash = await client.writeContract({
        address: EXECUTOR, abi: WITHDRAW_ABI,
        functionName: "withdraw", args: [assets],
      });
      setTxHash(hash);

      // Update goal status in DB to paused
      await api.withdrawGoal(goal.id);
      setStage("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // NoPosition = no Aave positions yet — just update DB
      if (msg.includes("NoPosition") || msg.includes("0x4")) {
        try { await api.withdrawGoal(goal.id); } catch { /* ignore */ }
        setStage("done");
      } else {
        setError(msg); setStage("confirm");
      }
    }
  }

  if (loading || !goal) return (
    <AppShell>
      <div style={{ maxWidth: 500 }}>
        {[0,1,2].map(i => <div key={i} className="card skeleton" style={{ height: 80, marginBottom: 12 }} />)}
      </div>
    </AppShell>
  );

  const progress   = goal.progress_pct ? parseFloat(goal.progress_pct) : 0;
  const targetAmt  = Number(goal.target_amount) / 1e18;
  const currentAmt = targetAmt * (progress / 100);
  const yieldAmt   = goal.yield_earned ? Number(goal.yield_earned) / 1e18 : 0;
  const daysLeft   = Math.max(0, Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / 86_400_000));
  const remaining  = targetAmt - currentAmt;
  const futureYield = (remaining * 0.072 * (daysLeft / 365)).toFixed(2);

  if (stage === "done") return (
    <AppShell>
      <div style={{ maxWidth: 500 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 52, marginBottom: 12 }}>✅</div>
          <h1 className="font-display" style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.03em", marginBottom: 8 }}>Withdrawal complete</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 14.5, lineHeight: 1.65 }}>All positions closed. <strong>USDm</strong> is back in your wallet.</p>
        </div>
        <div className="card" style={{ padding: "20px", marginBottom: 16 }}>
          {[
            { icon: "💰", label: "Amount returned (USDm)", value: `~$${currentAmt.toFixed(2)}` },
            { icon: "✨", label: "Yield earned",     value: `+$${yieldAmt.toFixed(2)}` },
            { icon: "⏸",  label: "Goal status",     value: "Paused — resume anytime" },
          ].map((row, i) => (
            <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: i < 2 ? 14 : 0 }}>
              <div style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", background: "var(--bg-secondary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>{row.icon}</div>
              <div>
                <div className="stat-label">{row.label}</div>
                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)", marginTop: 1 }}>{row.value}</div>
              </div>
            </div>
          ))}
        </div>
        {txHash && (
          <a href={`${EXPLORER}${txHash}`} target="_blank" rel="noopener noreferrer"
            style={{ display: "block", textAlign: "center", marginBottom: 16, fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>
            ↗ View on-chain transaction
          </a>
        )}
        <div className="card-inset" style={{ padding: "14px 16px", borderRadius: "var(--radius-lg)", marginBottom: 20, border: "1px solid var(--accent-light)" }}>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            <strong style={{ color: "var(--text-primary)" }}>Goal paused, not deleted.</strong> Resume anytime from the Goals page.
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button className="btn btn-secondary" onClick={() => router.push("/goals")}>My Goals</button>
          <button className="btn btn-primary" onClick={() => router.push("/dashboard")}>Dashboard →</button>
        </div>
      </div>
    </AppShell>
  );

  if (stage === "executing") return (
    <AppShell>
      <div style={{ maxWidth: 500, textAlign: "center", padding: "60px 0" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--accent-pale)", border: "2px solid var(--accent-light)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <div style={{ fontSize: 26, animation: "spin 2s linear infinite" }}>⚙️</div>
        </div>
        <h2 className="font-display" style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>Closing positions…</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>Please confirm the transaction in your wallet.</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </AppShell>
  );

  if (stage === "confirm") return (
    <AppShell>
      <div style={{ maxWidth: 500 }}>
        <button onClick={() => setStage("review")} className="btn btn-ghost btn-sm" style={{ marginBottom: 20, padding: "6px 0" }}>← Back</button>
        <h1 className="font-display" style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em", marginBottom: 6 }}>Confirm withdrawal</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 13.5, marginBottom: 22 }}>Your wallet signs one transaction to close all Aave positions.</p>
        {error && (
          <div style={{ background: "var(--red-light)", color: "var(--red)", borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>⚠ {error}</div>
        )}
        <div className="card" style={{ padding: "20px", marginBottom: 16 }}>
          <div className="stat-label" style={{ marginBottom: 14 }}>Positions to close</div>
          {aPositions.length > 0 ? (
            aPositions.map(p => (
              <div key={p.label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, fontSize: 13.5 }}>
                <span style={{ color: "var(--text-secondary)" }}>{p.label}</span>
                <span style={{ fontWeight: 600 }}>${(Number(p.balance) / 1e6).toFixed(2)}</span>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>All Aave stablecoin positions</div>
          )}
          <div style={{ borderTop: "1px solid var(--border-subtle)", marginTop: 12, paddingTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>You will receive</span>
              <span className="font-display" style={{ fontWeight: 700, fontSize: 16 }}>~${currentAmt.toFixed(2)} USDm</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--accent)" }}>
              ↩ USDC &amp; USDT auto-converted to <strong>USDm</strong> via Mento
            </div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-tertiary)", background: "var(--bg-secondary)", borderRadius: "var(--radius-md)", padding: "10px 12px", marginBottom: 20 }}>
          💡 20% performance fee applies to yield only. Dana kamu is never touched.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button className="btn btn-secondary" onClick={() => setStage("review")}>Cancel</button>
          <button onClick={executeWithdraw}
            style={{ background: "var(--red)", color: "#fff", borderRadius: "var(--radius-full)", padding: "12px 24px", fontSize: 15, fontWeight: 600, border: "none", cursor: "pointer", boxShadow: "0 4px 12px rgba(200,57,43,0.3)" }}>
            Confirm & sign →
          </button>
        </div>
      </div>
    </AppShell>
  );

  return (
    <AppShell>
      <div style={{ maxWidth: 500 }}>
        <button onClick={() => router.push("/dashboard")} className="btn btn-ghost btn-sm" style={{ marginBottom: 20, padding: "6px 0" }}>← Back</button>
        <h1 className="font-display" style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.03em", marginBottom: 6 }}>Withdraw funds</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 26 }}>Withdraw anytime. Goal will be paused — resume later.</p>

        <div className="card" style={{ overflow: "hidden", marginBottom: 16 }}>
          <div style={{ padding: "20px 22px", borderBottom: "1px solid var(--border-subtle)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div>
                <div className="stat-label" style={{ marginBottom: 4 }}>You will receive</div>
                <div className="font-display" style={{ fontSize: 34, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.03em" }}>~${currentAmt.toFixed(2)}</div>
                <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>
                  {progress.toFixed(1)}% of ${targetAmt.toFixed(0)} goal · {daysLeft} days remaining
                </div>
              </div>
              {progress < 100 ? <div className="badge badge-amber">⚠ Early exit</div> : <div className="badge badge-green">✓ Goal reached</div>}
            </div>
            <div className="progress-track" style={{ height: 6 }}><div className="progress-fill" style={{ width: `${Math.min(100, progress)}%` }} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "14px 22px" }}>
            {[
              { label: "Dana kamu",    value: `$${Math.max(0, currentAmt - yieldAmt).toFixed(2)}`, accent: false },
              { label: "Yield earned", value: `+$${yieldAmt.toFixed(2)}`,                          accent: true  },
              { label: "20% fee",      value: `-$${(yieldAmt * 0.2).toFixed(2)}`,                  accent: false },
            ].map((s, i) => (
              <div key={s.label} style={{ borderRight: i < 2 ? "1px solid var(--border-subtle)" : "none", paddingRight: i < 2 ? 14 : 0, paddingLeft: i > 0 ? 14 : 0 }}>
                <div className="stat-label" style={{ marginBottom: 3 }}>{s.label}</div>
                <div className="font-display" style={{ fontSize: 15, fontWeight: 700, color: s.accent ? "var(--accent)" : "var(--text-primary)" }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {daysLeft > 7 && remaining > 5 && progress < 100 && (
          <div className="card-inset" style={{ padding: "14px 16px", borderRadius: "var(--radius-lg)", marginBottom: 20, border: "1px solid var(--accent-light)" }}>
            <div style={{ display: "flex", gap: 10 }}>
              <span style={{ fontSize: 15 }}>💡</span>
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                {progress.toFixed(1)}% done, {daysLeft} days left. Staying in could earn{" "}
                <strong style={{ color: "var(--accent)" }}>+${futureYield}</strong> more in yield.
              </div>
            </div>
          </div>
        )}

        <button onClick={() => setStage("confirm")}
          style={{ width: "100%", background: "var(--red)", color: "#fff", borderRadius: "var(--radius-full)", padding: "16px", fontSize: 15, fontWeight: 600, border: "none", cursor: "pointer", boxShadow: "0 4px 12px rgba(200,57,43,0.3)" }}>
          Withdraw all funds →
        </button>
        <p style={{ textAlign: "center", fontSize: 12, color: "var(--text-tertiary)", marginTop: 12 }}>
          Goal paused, not deleted. Resume anytime.
        </p>
      </div>
    </AppShell>
  );
}
