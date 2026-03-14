/**
 * Smoke test — verifies all services are reachable and chain context is correct.
 * Run: pnpm smoke-test
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function check(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ ${label}`);
  } catch (err) {
    console.error(`  ❌ ${label}: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}

async function main() {
  console.log("\n🐷 Piggy Sentinel — Smoke Test\n");

  await check("API /health", async () => {
    const res = await fetch(`${API}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { chainId: number; network: string };
    console.log(`       chainId=${data.chainId} network=${data.network}`);
    if (data.chainId !== 11142220 && data.chainId !== 42220) {
      throw new Error(`Unexpected chainId: ${data.chainId}`);
    }
  });

  await check("DB connection (via API health)", async () => {
    const res = await fetch(`${API}/health`);
    const d   = await res.json() as { status: string };
    if (d.status !== "ok") throw new Error("API not healthy");
  });

  await check("Goals route reachable", async () => {
    const res = await fetch(`${API}/api/goals/status?wallet=0x0000000000000000000000000000000000000001`);
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
  });

  await check("Telegram route reachable", async () => {
    const res = await fetch(`${API}/api/telegram/link-status?wallet=0x0000000000000000000000000000000000000001`);
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
  });

  console.log("\nSmoke test complete.\n");
}

main();
