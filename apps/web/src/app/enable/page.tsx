"use client";
import { useState, useEffect } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom, parseUnits } from "viem";
import { celo } from "viem/chains";
import { defineChain } from "viem";
import { useRouter } from "next/navigation";
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

const REGISTER_GOAL_ABI = [{
  name: "registerGoal", type: "function", stateMutability: "nonpayable",
  inputs: [
    { name: "asset",       type: "address" },
    { name: "amount",      type: "uint256" },
    { name: "goalTarget",  type: "uint256" },
    { name: "goalDeadline",type: "uint256" },
    { name: "spendLimit",  type: "uint256" },
    { name: "stableBps",   type: "uint256" },
    { name: "lpBps",       type: "uint256" },
    { name: "wethBps",     type: "uint256" },
  ],
  outputs: [],
}] as const;

type Step = "goal" | "permission" | "done";

function Shell({ children, step, total }: { children: React.ReactNode; step: number; total: number }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      {/* Nav */}
      <header style={{ height: 48, borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", padding: "0 24px", gap: 12 }}>
        <span style={{ fontSize: 16 }}>🐷</span>
        <span style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          piggy<span style={{ color: "var(--green)" }}>.</span>sentinel
        </span>
        <div style={{ flex: 1, marginLeft: 16 }}>
          <div style={{ height: 2, background: "var(--border)", borderRadius: 2, overflow: "hidden", maxWidth: 200 }}>
            <div style={{ height: "100%", background: "var(--green)", width: `${(step / total) * 100}%`, transition: "width 0.4s ease" }} />
          </div>
        </div>
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text3)" }}>
          {step} / {total}
        </span>
      </header>

      {/* Content */}
      <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "48px 24px" }}>
        <div style={{ width: "100%", maxWidth: 440 }} className="fade-up">
          {children}
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "var(--mono)" }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 5 }}>{hint}</div>}
    </div>
  );
}

function MoneyInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text3)", fontFamily: "var(--mono)", fontSize: 14 }}>$</span>
      <input type="number" min="0" value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? "0"} className="input" style={{ paddingLeft: 28, fontFamily: "var(--mono)" }} />
    </div>
  );
}

export default function EnablePage() {
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const router  = useRouter();
  const address = user?.wallet?.address;

  const [step,        setStep]        = useState<Step>("goal");
  const [goalName,    setGoalName]    = useState("");
  const [goalAmount,  setGoalAmount]  = useState("");
  const [deadline,    setDeadline]    = useState("");
  const [spendLimit,  setSpendLimit]  = useState("");
  const [approving,   setApproving]   = useState(false);
  const [creating,    setCreating]    = useState(false);
  const [txHash,      setTxHash]      = useState<string | null>(null);
  const [error,       setError]       = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) router.push("/");
  }, [ready, authenticated]);

  // Default deadline = 12 months from now
  useEffect(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() + 1);
    setDeadline(d.toISOString().split("T")[0]);
  }, []);

  const canProceed = goalAmount && parseFloat(goalAmount) > 0 && deadline && spendLimit && parseFloat(spendLimit) > 0;

  async function handleApproveAndCreate() {
    if (!wallets[0] || !address || !EXECUTOR || !USDM_ADDR) {
      setError("Wallet or contract not configured"); return;
    }
    setApproving(true); setError(null);
    try {
      const provider = await wallets[0].getEthereumProvider();
      const client   = createWalletClient({ account: address as `0x${string}`, chain: CHAIN, transport: custom(provider) });

      const approvalAmount = parseUnits(spendLimit, 18);
      const hash = await client.writeContract({
        address: USDM_ADDR, abi: ERC20_ABI,
        functionName: "approve", args: [EXECUTOR, approvalAmount],
      });
      setTxHash(hash);

      // Register goal on-chain
      const deadlineTs = BigInt(Math.floor(new Date(deadline).getTime() / 1000));
      await client.writeContract({
        address: EXECUTOR, abi: REGISTER_GOAL_ABI,
        functionName: "registerGoal",
        args: [
          USDM_ADDR,                        // asset: USDm
          parseUnits(goalAmount, 18),        // amount: principal
          parseUnits(goalAmount, 18),        // goalTarget: same as amount (user can top up)
          deadlineTs,                        // goalDeadline
          parseUnits(spendLimit, 18),        // spendLimit
          10_000n,                           // stableBps: 100% stable
          0n,                               // lpBps: 0%
          0n,                               // wethBps: 0%
        ],
      });

      setApproving(false);
      setCreating(true);

      await api.createGoal({
        ownerWallet:        address,
        agentWalletAddress: EXECUTOR,
        targetAmount:       parseUnits(goalAmount, 18).toString(),
        targetCurrency:     "USDm",
        deadlineDate:       deadline,
        spendLimit:         parseUnits(spendLimit, 18).toString(),
        goalName:           goalName || undefined,
      });

      await api.activateGoal("latest");
      setStep("done");
      // Auto redirect ke dashboard setelah 2 detik
      setTimeout(() => router.push("/dashboard"), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApproving(false); setCreating(false);
    }
  }

  if (step === "done") return (
    <Shell step={2} total={2}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🐷</div>
        <h1 style={{ marginBottom: 8, color: "var(--text)" }}>All set!</h1>
        <p style={{ color: "var(--text2)", marginBottom: 8, lineHeight: 1.6 }}>
          Piggy is now managing your savings. She'll rebalance every 6 hours
          and notify you on milestones via Telegram.
        </p>
        <p style={{ color: "var(--text3)", fontSize: 12, fontFamily: "var(--mono)", marginBottom: 28 }}>
          Redirecting to dashboard…
        </p>

        {txHash && (
          <a href={`${EXPLORER}${txHash}`} target="_blank" rel="noopener noreferrer"
            style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--green)", textDecoration: "none", display: "block", marginBottom: 28 }}>
            View approval tx: {txHash.slice(0, 10)}…{txHash.slice(-8)} ↗
          </a>
        )}

        <div className="card" style={{ padding: "16px", marginBottom: 24, textAlign: "left" }}>
          {[
            { l: "Goal",        v: goalName || "Savings Goal" },
            { l: "Target",      v: `$${goalAmount} USDm` },
            { l: "Deadline",    v: deadline },
            { l: "Spend limit", v: `$${spendLimit} USDm / month` },
          ].map(row => (
            <div className="card-row" key={row.l}>
              <span style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--mono)" }}>{row.l}</span>
              <span style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--text)" }}>{row.v}</span>
            </div>
          ))}
        </div>

        <button className="btn btn-primary" onClick={() => router.push("/dashboard")} style={{ width: "100%" }}>
          Go to dashboard →
        </button>
      </div>
    </Shell>
  );

  if (step === "permission") return (
    <Shell step={2} total={2}>
      <div style={{ marginBottom: 24 }}>
        <div className="stat-label" style={{ marginBottom: 8 }}>Step 2 of 2</div>
        <h1 style={{ marginBottom: 6, color: "var(--text)" }}>Grant permission</h1>
        <p style={{ color: "var(--text2)", fontSize: 13, lineHeight: 1.6 }}>
          One wallet signature lets Piggy pull up to the spend limit you set.
          This is the only approval needed.
        </p>
      </div>

      {error && (
        <div style={{ background: "var(--red-dim)", border: "1px solid #F0606030", borderRadius: 6, padding: "10px 12px", marginBottom: 16, fontSize: 12, color: "var(--red)", fontFamily: "var(--mono)" }}>
          {error}
        </div>
      )}

      <div className="card" style={{ padding: "16px", marginBottom: 20 }}>
        {[
          { l: "Goal",       v: goalName || "Savings Goal" },
          { l: "Target",     v: `$${goalAmount} USDm` },
          { l: "Deadline",   v: deadline },
          { l: "Spend limit per epoch", v: `$${spendLimit} USDm` },
          { l: "Token",      v: "USDm (1 approval only)" },
          { l: "Contract",   v: EXECUTOR ? `${EXECUTOR.slice(0, 8)}…${EXECUTOR.slice(-6)}` : "not configured" },
        ].map(row => (
          <div className="card-row" key={row.l}>
            <span style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--mono)" }}>{row.l}</span>
            <span style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--text)" }}>{row.v}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-secondary" onClick={() => setStep("goal")} style={{ flex: 1 }}>
          ← Back
        </button>
        <button
          className="btn btn-primary"
          onClick={handleApproveAndCreate}
          disabled={approving || creating || !EXECUTOR || EXECUTOR?.includes("_ISI_")}
          style={{ flex: 2 }}
        >
          {approving ? "Awaiting signature…" : creating ? "Creating goal…" : "Approve & activate →"}
        </button>
      </div>

      {(!EXECUTOR || EXECUTOR?.includes("_ISI_")) && (
        <p style={{ marginTop: 10, fontSize: 11, color: "var(--red)", fontFamily: "var(--mono)" }}>
          Contract not deployed — set NEXT_PUBLIC_SENTINEL_EXECUTOR_ADDRESS
        </p>
      )}
    </Shell>
  );

  return (
    <Shell step={1} total={2}>
      <div style={{ marginBottom: 28 }}>
        <div className="stat-label" style={{ marginBottom: 8 }}>Step 1 of 2</div>
        <h1 style={{ marginBottom: 6, color: "var(--text)" }}>Set your goal</h1>
        <p style={{ color: "var(--text2)", fontSize: 13, lineHeight: 1.6 }}>
          What are you saving for? Piggy will build a strategy and manage it automatically.
        </p>
      </div>

      <Field label="Goal name (optional)">
        <input type="text" value={goalName} onChange={e => setGoalName(e.target.value)}
          placeholder="e.g. Emergency fund, New laptop…" className="input" />
      </Field>

      <Field label="Target amount (USDm)">
        <MoneyInput value={goalAmount} onChange={setGoalAmount} placeholder="1000" />
      </Field>

      <Field label="Deadline">
        <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="input" />
      </Field>

      <Field
        label="Spend limit per month (USDm)"
        hint="Max Piggy can pull from your wallet per 30-day epoch. Enforced on-chain."
      >
        <MoneyInput value={spendLimit} onChange={setSpendLimit} placeholder="200" />
      </Field>

      {/* Strategy preview */}
      <div className="card" style={{ padding: "14px 16px", marginBottom: 24 }}>
        <div className="stat-label" style={{ marginBottom: 10 }}>Strategy preview</div>
        {[
          { l: "USDT → Aave", p: "60%", c: "#00D4A8", apy: "8.89%" },
          { l: "USDC → Aave", p: "30%", c: "#5B8DEF", apy: "2.61%" },
          { l: "USDm → Aave", p: "10%", c: "#7C6EF5", apy: "1.07%" },
        ].map(a => (
          <div key={a.l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: a.c, display: "inline-block" }} />
              <span style={{ fontFamily: "var(--mono)", color: "var(--text2)" }}>{a.l}</span>
            </div>
            <div style={{ display: "flex", gap: 14 }}>
              <span style={{ fontFamily: "var(--mono)", color: "var(--text3)" }}>{a.apy}</span>
              <span style={{ fontFamily: "var(--mono)", color: "var(--text)", fontWeight: 600 }}>{a.p}</span>
            </div>
          </div>
        ))}
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 10, paddingTop: 10, display: "flex", justifyContent: "space-between", fontSize: 12 }}>
          <span style={{ color: "var(--text3)", fontFamily: "var(--mono)" }}>Blended APY</span>
          <span style={{ fontFamily: "var(--mono)", color: "var(--green)", fontWeight: 600 }}>~6.22%</span>
        </div>
      </div>

      <button
        className="btn btn-primary"
        onClick={() => setStep("permission")}
        disabled={!canProceed}
        style={{ width: "100%" }}
      >
        Continue → Grant permission
      </button>
    </Shell>
  );
}
