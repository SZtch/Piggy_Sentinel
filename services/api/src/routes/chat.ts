import type { FastifyInstance } from "fastify";
import { x402PaymentGate } from "../middleware/x402.js";
import { getActiveGoalByOwner, insertNotification, getTelegramChatId } from "@piggy/db";
import { logger } from "@piggy/shared";
import { FREE_CHAT_LIMIT_PER_MONTH } from "@piggy/shared";

/**
 * Chat routes — Penny AI assistant.
 *
 * POST /api/chat
 *   Free tier: first FREE_CHAT_LIMIT_PER_MONTH messages/month.
 *   Paid tier: x402 payment verified, but Penny ALWAYS answers.
 *   User is informed via usageFooter — never hard-blocked.
 */

// In-memory chat limit tracker (use DB in production)
const chatCounts = new Map<string, { count: number; month: string }>();

function getCurrentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function getChatCount(wallet: string): number {
  const entry = chatCounts.get(wallet);
  if (!entry || entry.month !== getCurrentMonth()) return 0;
  return entry.count;
}

function incrementChatCount(wallet: string): void {
  const month = getCurrentMonth();
  const entry = chatCounts.get(wallet);
  if (!entry || entry.month !== month) {
    chatCounts.set(wallet, { count: 1, month });
  } else {
    entry.count++;
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
    return `_💬 This is your last free message this month. After this, Penny charges 0.01 USDC/message — still cheaper than a financial advisor 🐷_`;
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

  const systemPrompt = `You are Penny, the AI savings agent for Piggy Sentinel.
You help users reach their savings goals on the Celo blockchain.
Be concise, friendly, and supportive. Always respond in English.
Do not mention technical blockchain terms unless the user asks.
Do not mention protocol names (Aave, Mento, Uniswap) unless the user asks.

${goalContext}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-sonnet-4-20250514",
      max_tokens: 500,
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

    const countBefore = getChatCount(wallet);
    const isPaid = countBefore >= FREE_CHAT_LIMIT_PER_MONTH;

    // Paid tier — verify x402 if header provided
    if (isPaid) {
      const paymentHeader = req.headers["x-payment"] as string | undefined;
      if (paymentHeader) {
        await x402PaymentGate(req, reply);
        if (reply.sent) return; // payment invalid — gate already replied
      } else if (process.env.TREASURY_ADDRESS) {
        // Production: log missing payment but still answer
        logger.warn(`x402 payment missing for paid chat from ${wallet} (message #${countBefore + 1})`);
      }
    }

    // Load goal context
    let goalContext = "User has no active savings goal yet.";
    try {
      const goal = await getActiveGoalByOwner(wallet);
      if (goal) {
        const deadline = new Date(goal.deadline);
        const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);
        const progress = goal.progress_pct != null ? parseFloat(goal.progress_pct) : 0;

        goalContext = `User's current goal:
- Target: ${goal.target_amount} USDm
- Progress: ${progress.toFixed(1)}%
- Deadline: ${deadline.toLocaleDateString("en-US")} (${daysLeft} days remaining)
- Status: ${goal.status}`;
      }
    } catch (err) {
      logger.warn("Failed to load goal context", err);
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
                messageText:    `*Piggy Sentinel* 💳\n\nA micropayment of 0.01 USDC was charged for your Penny message.\n\nYou've used your 10 free messages this month. Each additional message costs 0.01 USDC — still cheaper than a financial advisor 🐷`,
              });
            }
          }
        } catch (err) {
          // Non-critical — don't fail the chat response over a notification error
          logger.warn("x402 Telegram notification failed", err);
        }
      }

      return {
        answer,
        usageFooter, // null if no message needed
        chatCount:   getChatCount(wallet),
        freeLimit:   FREE_CHAT_LIMIT_PER_MONTH,
        remaining:   Math.max(0, FREE_CHAT_LIMIT_PER_MONTH - getChatCount(wallet)),
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

    const count = getChatCount(wallet);
    return {
      used:       count,
      freeLimit:  FREE_CHAT_LIMIT_PER_MONTH,
      remaining:  Math.max(0, FREE_CHAT_LIMIT_PER_MONTH - count),
      isPaidTier: count >= FREE_CHAT_LIMIT_PER_MONTH,
    };
  });
}
