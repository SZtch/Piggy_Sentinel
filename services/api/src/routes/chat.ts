import type { FastifyInstance } from "fastify";
import { x402PaymentGate } from "../middleware/x402.js";
import { getActiveGoalByOwner, insertNotification, getTelegramChatId, db, chatCounts } from "@piggy/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "@piggy/shared";
import { FREE_CHAT_LIMIT_PER_MONTH } from "@piggy/shared";
import { getCurrentApy } from "@piggy/adapters/aave.js";
import { analyzeGoalFeasibility } from "@piggy/agent/intelligence/goalFeasibility.js";
import { computePaceTracking } from "@piggy/agent/intelligence/paceTracking.js";

/**
 * Chat routes — Penny AI assistant.
 *
 * POST /api/chat
 *   Free tier: first FREE_CHAT_LIMIT_PER_MONTH messages/month.
 *   Paid tier: x402 payment verified, but Penny ALWAYS answers.
 *   User is informed via usageFooter — never hard-blocked.
 *
 * Chat count disimpan di DB (tabel chat_counts) — persistent across
 * server restarts dan multi-instance deployment.
 */

function getCurrentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}`;
}

async function getChatCount(wallet: string): Promise<number> {
  const month = getCurrentMonth();
  try {
    const row = await db
      .select({ count: chatCounts.count })
      .from(chatCounts)
      .where(and(eq(chatCounts.wallet, wallet), eq(chatCounts.month, month)))
      .limit(1)
      .then(r => r[0]);
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}

async function incrementChatCount(wallet: string): Promise<void> {
  const month = getCurrentMonth();
  try {
    await db
      .insert(chatCounts)
      .values({ wallet, month, count: 1 })
      .onConflictDoUpdate({
        target: [chatCounts.wallet, chatCounts.month],
        set:    { count: sql`${chatCounts.count} + 1`, updatedAt: new Date() },
      });
  } catch (err) {
    logger.warn("incrementChatCount failed", err as object);
  }
}

/**
 * Build a friendly footer based on usage.
 * Penny always answers — user is gently informed, never blocked.
 */
function buildUsageFooter(countBefore: number): string | null {
  const remaining = FREE_CHAT_LIMIT_PER_MONTH - countBefore - 1;

  if (countBefore === FREE_CHAT_LIMIT_PER_MONTH - 3) {
    return `_💬 ${remaining} free messages left this month._`;
  }
  if (countBefore === FREE_CHAT_LIMIT_PER_MONTH - 2) {
    return `_💬 ${remaining} free message left this month. After that, 0.01 USDC/message._`;
  }
  if (countBefore === FREE_CHAT_LIMIT_PER_MONTH - 1) {
    return `_💬 This is your last free message this month. After this, Penny charges 0.01 USDC/message -- still cheaper than a financial advisor 🐷_`;
  }
  if (countBefore >= FREE_CHAT_LIMIT_PER_MONTH) {
    return `_💳 0.01 USDC charged for this message._`;
  }
  return null;
}

async function callClaude(userMessage: string, goalContext: string): Promise<string> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    logger.warn("CLAUDE_API_KEY not set — returning mock response");
    return "Hi! I'm Penny 🐷 — CLAUDE_API_KEY is not configured on this server.";
  }

  const systemPrompt = `Kamu adalah Penny 🐷 — AI guardian nabung yang menjaga dan menumbuhkan dana kamu di Piggy Sentinel.

## Siapa kamu
Bukan chatbot biasa. Kamu agent yang aktif kerja 24/7 — setiap 6 jam kamu cek kondisi pasar, evaluasi risiko, dan rebalance kalau perlu. Dana user selalu di wallet mereka, kamu cuma mengoptimalkan yield-nya.

Kamu guardian, bukan banker. Kamu peduli sama goal user dan ikut senang kalau mereka berhasil.

## Cara bicara
- Santai dan hangat — kayak teman yang kebetulan ngerti finance
- Pakai "kamu" dan "aku", bukan "Anda" atau "saya"
- Singkat — maksimal 3-4 kalimat
- Bahasa sehari-hari, tidak formal
- Emoji sesekali oke (🐷 ✨ 📈) tapi jangan lebay
- Tidak pakai jargon teknis kecuali user mulai duluan
- Balas dalam bahasa user — Indonesia ya Indonesia, English ya English
- Bold untuk angka penting: **+$2.14** akan tampil tebal

## Yang bisa kamu bantu
- Cerita progress nabung dan kapan goal bisa tercapai
- Jelaskan kenapa aku rebalance atau kenapa aku pause otomatis
- Motivasi kalau user lagi behind pace
- Jawab pertanyaan soal Piggy dengan bahasa mudah
- Bantu user paham risiko — selalu jujur, tidak over-promise

## Yang tidak boleh kamu lakukan
- Jangan kasih saran investasi spesifik
- Jangan janjiin return pasti — selalu bilang "estimasi" atau "sekitar"
- Jangan bahas topik di luar nabung/Piggy
- Jangan bocorkan detail teknis internal
- Jangan pura-pura bisa eksekusi transaksi lewat chat

## Konteks user saat ini
${goalContext}\`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-sonnet-4-20250514",
      max_tokens: 300,
      system:     systemPrompt,
      messages:   [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error: ${response.status} ${err}`);
  }

  const data = await response.json() as { content: { type: string; text: string }[] };
  return data.content.find(b => b.type === "text")?.text ?? "Maaf, ada error.";
}

export async function chatRoutes(app: FastifyInstance) {

  /**
   * POST /api/chat
   * Body: { wallet: string; message: string }
   *
   * Penny always answers. Usage footer is appended to inform user of limit status.
   * x402 payment verified for paid tier (but answer is still sent).
   */
  app.post<{
    Body: { wallet: string; message: string }
  }>("/", async (req, reply) => {
    const { wallet, message } = req.body;

    if (!wallet || !message) {
      return reply.code(400).send({ error: "wallet and message required" });
    }

    const countBefore = await getChatCount(wallet);
    const isPaid = countBefore >= FREE_CHAT_LIMIT_PER_MONTH;

    // Paid tier — enforce x402
    if (isPaid) {
      const paymentHeader = req.headers["x-payment"] as string | undefined;
      if (paymentHeader) {
        // Ada header — verifikasi on-chain
        await x402PaymentGate(req, reply);
        if (reply.sent) return; // payment invalid — gate sudah reply
      } else if (process.env.TREASURY_ADDRESS) {
        // Production: tidak ada payment header → tolak dengan 402
        return reply.code(402).send({
          error: "Payment Required",
          x402: {
            scheme:   "exact",
            network:  `eip155:42220`,
            asset:    process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "USDC",
            payTo:    process.env.TREASURY_ADDRESS,
            amount:   "0.01",
            decimals: 6,
            memo:     "piggy-sentinel-chat",
          },
          message: "You've used your 10 free messages. Send 0.01 USDC to continue.",
        });
      }
      // Dev mode (no TREASURY_ADDRESS) — allow through with warning
    }

    // Load goal context + live data
    let goalContext = "User has no active savings goal yet. Encourage them to set one!";
    try {
      const goal = await getActiveGoalByOwner(wallet);
      if (goal) {
        const deadline    = new Date(goal.deadline);
        const daysLeft    = Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);
        const progress    = goal.progressPct != null ? parseFloat(goal.progressPct) : 0;
        const targetUSD   = Number(goal.targetAmount) / 1e18;
        const currentUSD  = targetUSD * (progress / 100);
        const yieldEarned = goal.yieldEarned ? Number(goal.yieldEarned) / 1e18 : 0;
        const monthsLeft  = Math.max(1, daysLeft / 30);
        const goalStart   = new Date(goal.createdAt ?? Date.now());
        const monthsElapsed = Math.max(0,
          (Date.now() - goalStart.getTime()) / (30 * 24 * 3600 * 1000)
        );

        // Fetch live APYs
        const [apyUsdm, apyUsdc, apyUsdt] = await Promise.allSettled([
          getCurrentApy("USDm").catch(() => null),
          getCurrentApy("USDC").catch(() => null),
          getCurrentApy("USDT").catch(() => null),
        ]);
        const apy = {
          usdm: apyUsdm.status === "fulfilled" ? (apyUsdm.value ?? 1.07) : 1.07,
          usdc: apyUsdc.status === "fulfilled" ? (apyUsdc.value ?? 2.61) : 2.61,
          usdt: apyUsdt.status === "fulfilled" ? (apyUsdt.value ?? 8.89) : 8.89,
        };
        const blendedApy = apy.usdt * 0.6 + apy.usdc * 0.3 + apy.usdm * 0.1;

        // Feasibility — kapan goal bisa tercapai?
        let feasibility: ReturnType<typeof analyzeGoalFeasibility> | null = null;
        try {
          feasibility = analyzeGoalFeasibility({
            currentBalance:    currentUSD,
            goalAmount:        targetUSD,
            timeHorizonMonths: monthsLeft,
            expectedAPY:       blendedApy / 100,
            plannedMonthlyDeposit: Number(goal.monthlyDeposit ?? 0) / 1e18,
          });
        } catch {}

        // Pace tracking
        let pace: { paceStatus: string; message: string } | null = null;
        try {
          pace = computePaceTracking({
            currentBalance:  currentUSD,
            startingBalance: Number(goal.principalDeposited ?? goal.targetAmount) / 1e18,
            goalAmount:      targetUSD,
            monthsElapsed,
            totalMonths:     monthsLeft + monthsElapsed,
            expectedAPY:     blendedApy / 100,
            monthlyDeposit:  Number(goal.monthlyDeposit ?? 0) / 1e18,
          });
        } catch {}

        goalContext = `User's savings goal:
- Target: $${targetUSD.toFixed(2)} USDm
- Current balance: $${currentUSD.toFixed(2)} (${progress.toFixed(1)}% complete)
- Yield earned so far: +$${yieldEarned.toFixed(2)}
- Deadline: ${deadline.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} (${daysLeft} days left)
- Status: ${goal.status}${goal.soft_paused ? " (paused)" : ""}

Live APY from Aave (Celo):
- USDT: ${apy.usdt.toFixed(2)}%
- USDC: ${apy.usdc.toFixed(2)}%
- USDm: ${apy.usdm.toFixed(2)}%
- Blended (60/30/10): ~${blendedApy.toFixed(2)}%

Current yield landscape (for context when user asks about alternatives):
- Aave V3 Celo is the only active stablecoin lending protocol on Celo
- Uniswap V3 LP available for moderate/aggressive tier (higher yield, has IL risk)
- Benchmark: US Treasury ~4.5%, CELO staking ~4%, Piggy blended ~${blendedApy.toFixed(2)}%
- Penny should always frame Aave APY relative to these benchmarks

${feasibility ? `Feasibility analysis:
- Projected value at deadline: $${feasibility.projectedValueFromBalance.toFixed(2)}
- Goal achievable with current balance + yield: ${feasibility.achievableWithBalance ? "YES ✅" : "NOT YET"}
- ${feasibility.achievableWithBalance ? "On track — yield alone can reach the target" : `Monthly addition needed to close gap: ~$${feasibility.requiredMonthlyDeposit.toFixed(2)}/month`}
- Assessment: ${feasibility.verdict}` : ""}

${pace ? `Pace: ${pace.paceStatus.replace(/_/g, " ")} — ${pace.message}` : ""}`;
      }
    } catch (err) {
      logger.warn("Failed to load goal context", err as object);
    }

    // Call Claude — always answer
    try {
      const answer = await callClaude(message, goalContext);
      incrementChatCount(wallet);

      const usageFooter = buildUsageFooter(countBefore);

      // Send Telegram notification when x402 micropayment is charged
      // Only notify once: exactly when the user hits their limit (first paid message)
      if (isPaid) {
        try {
          const activeGoal = await getActiveGoalByOwner(wallet);
          if (activeGoal) {
            const chatId = await getTelegramChatId(wallet);
            if (chatId) {
              await insertNotification({
                goalId:         activeGoal.id,
                telegramChatId: chatId,
                type:           "x402_charged",
                messageText:    `*Piggy Sentinel* 💳\n\nA micropayment of 0.01 USDC was charged for your Penny message.\n\nYou've used your 10 free messages this month. Each additional message costs 0.01 USDC -- still cheaper than a financial advisor 🐷`,
              });
            }
          }
        } catch (err) {
          // Non-critical — don't fail the chat response over a notification error
          logger.warn("x402 Telegram notification failed", err as object);
        }
      }

      return {
        answer,
        usageFooter, // null if no message needed
        chatCount:   await getChatCount(wallet),
        freeLimit:   FREE_CHAT_LIMIT_PER_MONTH,
        remaining:   Math.max(0, FREE_CHAT_LIMIT_PER_MONTH - (await getChatCount(wallet))),
        isPaid,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Claude API failed", msg);
      return reply.code(500).send({ error: "AI service temporarily unavailable." });
    }
  });

  /**
   * GET /api/chat/limit?wallet=0x...
   */
  app.get<{ Querystring: { wallet: string } }>("/limit", async (req, reply) => {
    const { wallet } = req.query;
    if (!wallet) return reply.code(400).send({ error: "wallet required" });

    const count = await getChatCount(wallet);
    return {
      used:       count,
      freeLimit:  FREE_CHAT_LIMIT_PER_MONTH,
      remaining:  Math.max(0, FREE_CHAT_LIMIT_PER_MONTH - count),
      isPaidTier: count >= FREE_CHAT_LIMIT_PER_MONTH,
    };
  });
}
