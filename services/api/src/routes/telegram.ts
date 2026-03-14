import type { FastifyInstance } from "fastify";
import {
  createTelegramLink, confirmTelegramLink,
  getTelegramChatId, getWalletForChatId,
} from "@piggy/db";
import { generateCode }                from "@piggy/shared";
import { TELEGRAM_LINK_CODE_TTL_MS }   from "@piggy/shared";

export async function telegramRoutes(app: FastifyInstance) {
  // POST /api/telegram/request-link
  // Called by the web app. Returns a short code the user DMs to the bot.
  app.post<{ Body: { walletAddress: string } }>("/request-link", async (req, reply) => {
    const { walletAddress } = req.body;
    if (!walletAddress) return reply.code(400).send({ error: "walletAddress required" });
    const code      = generateCode();
    const expiresAt = new Date(Date.now() + TELEGRAM_LINK_CODE_TTL_MS);
    await createTelegramLink(walletAddress, code, expiresAt);
    return { code, expiresAt };
  });

  // POST /api/telegram/confirm-link
  // Called by the bot when a user sends /start <code>.
  app.post<{ Body: { code: string; chatId: string } }>("/confirm-link", async (req, reply) => {
    const { code, chatId } = req.body;
    if (!code || !chatId) return reply.code(400).send({ error: "code and chatId required" });
    const rows = await confirmTelegramLink(code, chatId);
    if (!rows || rows.length === 0) return reply.code(404).send({ error: "invalid or expired code" });
    return { linked: true, walletAddress: rows[0].wallet_address };
  });

  // GET /api/telegram/link-status?wallet=0x...
  app.get<{ Querystring: { wallet: string } }>("/link-status", async (req, reply) => {
    const { wallet } = req.query;
    if (!wallet) return reply.code(400).send({ error: "wallet required" });
    const chatId = await getTelegramChatId(wallet);
    return { linked: !!chatId, chatId: chatId ?? null };
  });

  // GET /api/telegram/wallet-for-chat?chatId=...
  // Used by the bot to look up which wallet owns a Telegram session.
  app.get<{ Querystring: { chatId: string } }>("/wallet-for-chat", async (req, reply) => {
    const { chatId } = req.query;
    if (!chatId) return reply.code(400).send({ error: "chatId required" });
    const wallet = await getWalletForChatId(chatId);
    if (!wallet) return reply.code(404).send({ error: "chat not linked" });
    return { walletAddress: wallet };
  });
}
