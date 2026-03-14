"use client";
import { useState, useEffect } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom, parseUnits } from "viem";
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

const EXECUTOR   = process.env.NEXT_PUBLIC_SENTINEL_EXECUTOR_ADDRESS as `0x${string}`;
const USDM_ADDR  = process.env.NEXT_PUBLIC_USDM_ADDRESS as `0x${string}`;
const IS_MAINNET = process.env.NEXT_PUBLIC_APP_ENV === "prod";
const CHAIN      = IS_MAINNET ? celo : celoSepolia;
const EXPLORER   = IS_MAINNET ? "https://celo.blockscout.com/tx/" : "https://celo-sepolia.blockscout.com/tx/";

const ERC20_ABI = [{
  name: "approve", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ type: "bool" }],
}] as const;

const REASON_MSG: Record<string, { title: string; desc: string; fix: string }> = {
  allowance_revoked: {
    title: "Spending permission was revoked",
    desc:  "Piggy detected that the token allowance was removed. Re-approve permission to resume automation.",
    fix:   "Re-approve permission",
  },
  allowance_expired: {
    title: "Spending permission expired",
    desc:  "The allowance period has passed. Re-approve to continue.",
    fix:   "Re-approve permission",
  },
  balance_insufficient: {
    title: "Wallet balance too low",
    desc:  "Your USDm balance dropped below the minimum. Top up your wallet, then reactivate.",
    fix:   "Reactivate Piggy",
  },
  allowance_too_low: {
    title: "Allowance too low",
    desc:  "The approved amount is less than required. Increase the allowance to continue.",
    fix:   "Re-approve permission",
  },
};

export default function ReactivatePage() {
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const router  = useRouter();
  const address = user?.wallet?.address;

  const [goal,    setGoal]    = useState<GoalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [txHash,  setTxHash]  = useState<string | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [done,    setDone]    = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) { router.push("/"); return; }
    if (!address) return;
    api.getGoalStatus(address)
      .then(g => {
        const gd = g as GoalData;
        if (!gd?.id || gd.status !== "action_required") { router.push("/dashboard"); return; }
        setGoal(gd);
      })
      .catch(() => router.push("/dashboard"))
      .finally(() => setLoading(false));
  }, [ready, authenticated, address]);

  async function handleReapprove() {
    if (!goal || !wallets[0] || !address) { setError("Wallet not ready"); return; }
    setWorking(true); setError(null);
    try {
      const provider = await wallets[0].getEthereumProvider();
      const client   = createWalletClient({ account: address as `0x${string}`, chain: CHAIN, transport: custom(provider) });

      // Re-approve: 1.5x remaining target as safety buffer
      const targetAmt   = Number(goal.target_amount) / 1e18;
      const remaining   = targetAmt * (1 - (parseFloat(goal.progress_pct ?? "0") / 100));
      const approvalAmt = Math.max(remaining * 1.5, 10);

      const hash = await client.writeContract({
        address:      USDM_ADDR ?? "0x0",
        abi:          ERC20_ABI,
        functionName: "approve",
        args:         [EXECUTOR ?? "0x0", parseUnits(approvalAmt.toFixed(6), 18)],
      });
      setTxHash(hash);

      // Tell backend to clear action_required
      await api.reactivateGoal(goal.id);
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }

  if (loading || !goal) return (
    <AppShell>
      <div className="card skeleton" style={{ height: 280, maxWidth: 500 }} />
    </AppShell>
  );

  const reason    = goal.action_reason ?? "allowance_revoked";
  const meta      = REASON_MSG[reason] ?? REASON_MSG["allowance_revoked"];
  const needsTx   = reason !== "balance_insufficient";
  const progress  = parseFloat(goal.progress_pct ?? "0");
  const targetAmt = Number(goal.target_amount) / 1e18;
  const current   = targetAmt * (progress / 100);

  if (done) return (
    <AppShell>
      <div style={{ maxWidth: 500 }}>
        <div style={{ textAlign: "center", padding: "40px 0 28px" }}>
          <div style={{ fontSize: 52, marginBottom: 12 }}>✅</div>
          <h2 className="font-display" style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.03em", marginBottom: 8 }}>
            Piggy is back!
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
            Automation has been restored. Piggy will resume on the next cycle.
          </p>
        </div>
        {txHash && (
          <a href={`${EXPLORER}${txHash}`} target="_blank" rel="noopener noreferrer"
            style={{ display: "block", textAlign: "center", marginBottom: 20, fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>
            ↗ View transaction
          </a>
        )}
        <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => router.push("/dashboard")}>
          Back to dashboard →
        </button>
      </div>
    </AppShell>
  );

  return (
    <AppShell>
      <div style={{ maxWidth: 500 }}>
        <button onClick={() => router.push("/dashboard")} className="btn btn-ghost btn-sm" style={{ marginBottom: 20, padding: "6px 0" }}>
          ← Back
        </button>

        <h1 className="font-display" style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.03em", marginBottom: 6 }}>
          Action required
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 13.5, marginBottom: 24 }}>
          Piggy has paused automation until you resolve this.
        </p>

        {/* Reason card */}
        <div style={{ background: "var(--amber-light)", border: "1.5px solid var(--amber)", borderRadius: "var(--radius-lg)", padding: "18px 20px", marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span style={{ fontSize: 22 }}>⚠️</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: "var(--amber)", marginBottom: 4 }}>{meta.title}</div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.55 }}>{meta.desc}</div>
            </div>
          </div>
        </div>

        {/* Goal context */}
        <div className="card" style={{ padding: "18px 20px", marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr" }}>
            {[
              { label: "Saved so far", value: `$${current.toFixed(2)}` },
              { label: "Progress",     value: `${progress.toFixed(1)}%` },
              { label: "Goal target",  value: `$${targetAmt.toFixed(0)}` },
            ].map((s, i) => (
              <div key={s.label} style={{ borderRight: i < 2 ? "1px solid var(--border-subtle)" : "none", paddingRight: i < 2 ? 14 : 0, paddingLeft: i > 0 ? 14 : 0 }}>
                <div className="stat-label" style={{ marginBottom: 3 }}>{s.label}</div>
                <div className="font-display" style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)" }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* How to fix */}
        {needsTx && (
          <div className="card-inset" style={{ padding: "14px 16px", borderRadius: "var(--radius-lg)", marginBottom: 20 }}>
            <div className="stat-label" style={{ marginBottom: 8 }}>What happens when you click below</div>
            {[
              "A wallet signature approves a new spending permission",
              "Piggy immediately resumes automation",
              "No funds are moved during re-approval",
            ].map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 8, fontSize: 12.5, color: "var(--text-secondary)", marginBottom: i < 2 ? 6 : 0 }}>
                <span style={{ color: "var(--accent)", fontWeight: 700, flexShrink: 0 }}>✓</span> {s}
              </div>
            ))}
          </div>
        )}

        {!needsTx && (
          <div className="card-inset" style={{ padding: "14px 16px", borderRadius: "var(--radius-lg)", marginBottom: 20 }}>
            <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.55 }}>
              Top up your wallet with USDm, then click Reactivate. No signature needed — Piggy will detect the balance automatically.
            </div>
          </div>
        )}

        {error && (
          <div style={{ background: "var(--red-light)", color: "var(--red)", borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>⚠ {error}</div>
        )}

        {txHash && !done && (
          <a href={`${EXPLORER}${txHash}`} target="_blank" rel="noopener noreferrer"
            style={{ display: "block", textAlign: "center", marginBottom: 10, fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>
            ↗ View transaction
          </a>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button className="btn btn-secondary" onClick={() => router.push("/withdraw")}>
            Withdraw instead
          </button>
          <button className="btn btn-primary" onClick={handleReapprove} disabled={working}>
            {working ? "Processing…" : meta.fix + " 🔑"}
          </button>
        </div>
      </div>
    </AppShell>
  );
}
