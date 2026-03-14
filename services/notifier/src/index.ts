/**
 * Piggy Sentinel — Notification Pusher
 *
 * Polls DB for pending notifications and delivers them via Telegram Bot API.
 * Uses the same bot token as OpenClaw — shares one Telegram bot.
 *
 * OpenClaw handles inbound messages (user → Penny).
 * This service handles outbound pushes (agent → user).
 */
import { getPendingNotifications, markNotificationSent } from "@piggy/db";
import { logger } from "@piggy/shared";

const BOT_TOKEN       = process.env.TELEGRAM_BOT_TOKEN ?? "";
const POLL_INTERVAL_MS = 30_000;

/**
 * Push a message to a Telegram chat via Bot API.
 */
async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  if (!BOT_TOKEN) {
    logger.info(`[notifier] (dev — no token) → chat ${chatId}: ${text.slice(0, 80)}…`);
    return true;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id:    chatId,
        text,
        parse_mode: "Markdown",
      }),
    });

    if (!res.ok) {
      const err = await res.json() as { description?: string };
      logger.warn(`[notifier] Telegram API error for chat ${chatId}: ${err.description ?? res.status}`);
      return false;
    }

    return true;
  } catch (err) {
    logger.error("[notifier] send failed", err);
    return false;
  }
}

async function flushNotifications() {
  let pending;
  try {
    pending = await getPendingNotifications();
  } catch (err) {
    logger.error("[notifier] DB read failed", err);
    return;
  }

  if (pending.length === 0) return;

  logger.info(`[notifier] flushing ${pending.length} notifications`);

  for (const n of pending) {
    const ok = await sendTelegramMessage(n.telegramChatId, n.messageText);
    if (ok) {
      await markNotificationSent(n.id);
      logger.info(`[notifier] sent: ${n.notificationType} → chat ${n.telegramChatId}`);
    }
  }
}

async function main() {
  logger.info("[notifier] starting — polling every 30s");

  if (!BOT_TOKEN) {
    logger.warn("[notifier] TELEGRAM_BOT_TOKEN not set — notifications will only be logged (dev mode)");
  }

  await flushNotifications();
  setInterval(flushNotifications, POLL_INTERVAL_MS);
}

main().catch(err => {
  logger.error("[notifier] fatal", err);
  process.exit(1);
});
