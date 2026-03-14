import type { FastifyRequest, FastifyReply } from "fastify";
import { createPublicClient, http, parseUnits, type Address } from "viem";
import { activeChain } from "@piggy/config/chains";
import { getTokenAddress } from "@piggy/config/tokens";
import { CHAIN_ID } from "@piggy/config/chains";
import { logger } from "@piggy/shared";
import { isPaymentUsed, markPaymentUsed } from "@piggy/db";

/**
 * x402 Payment Middleware for Piggy Sentinel chat API.
 *
 * Flow:
 *   1. Request hits /api/chat
 *   2. Middleware checks for x-payment header
 *   3. If missing → return 402 with payment requirements
 *   4. If present → verify payment on-chain
 *   5. Verified → allow request through
 *
 * Payment:
 *   Asset:     USDC (on Celo)
 *   Amount:    0.01 USDC per chat message
 *   Recipient: TREASURY_ADDRESS
 *
 * Replay Protection:
 *   Pakai tabel used_payments di DB — persistent across restarts dan multi-instance.
 *   Sebelumnya pakai in-memory Set yang hilang saat service restart,
 *   memungkinkan orang pakai txHash yang sama berkali-kali setelah restart.
 */

const CHAT_PRICE_USDC = "0.01";
const TREASURY        = process.env.TREASURY_ADDRESS as Address | undefined;
const USDC_ADDRESS    = getTokenAddress(CHAIN_ID, "USDC") as Address;

const publicClient = createPublicClient({
  chain:     activeChain,
  transport: http(),
});

// ── Header format validation ───────────────────────────────────────────────
//
// Expected: "0x<64 hex chars>:0x<40 hex chars>"
//   txHash  = 0x + 32 bytes = 66 chars
//   address = 0x + 20 bytes = 42 chars
//
const PAYMENT_HEADER_REGEX = /^0x[0-9a-fA-F]{64}:0x[0-9a-fA-F]{40}$/;

function parsePaymentHeader(header: string): { txHash: `0x${string}`; payer: Address } | null {
  if (!PAYMENT_HEADER_REGEX.test(header)) return null;
  const colon = header.indexOf(":");
  return {
    txHash: header.slice(0, colon) as `0x${string}`,
    payer:  header.slice(colon + 1) as Address,
  };
}

/**
 * Verify bahwa txHash berisi USDC transfer >= 0.01 ke TREASURY.
 *
 * Replay protection sekarang pakai DB (used_payments table):
 *   - Cek DB dulu sebelum RPC call (hemat biaya)
 *   - Tulis ke DB SETELAH verifikasi on-chain berhasil
 *   - ON CONFLICT DO NOTHING = aman dari race condition kalau
 *     2 request datang bersamaan dengan txHash yang sama
 */
async function verifyPayment(txHash: `0x${string}`, payer: Address): Promise<boolean> {

  // ── Replay check — DB, bukan in-memory ──────────────────────────────────
  // Cek dulu sebelum RPC call — kalau sudah dipakai, tolak langsung
  const alreadyUsed = await isPaymentUsed(txHash);
  if (alreadyUsed) {
    logger.warn(`x402 replay attempt blocked: ${txHash}`);
    return false;
  }

  if (!TREASURY) {
    logger.warn("TREASURY_ADDRESS not set — skipping x402 verification in dev");
    return true;
  }

  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") return false;

    const minAmount = parseUnits(CHAT_PRICE_USDC, 6); // USDC 6 desimal

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== USDC_ADDRESS.toLowerCase()) continue;

      const from  = log.topics[1] ? `0x${log.topics[1].slice(26)}` : null;
      const to    = log.topics[2] ? `0x${log.topics[2].slice(26)}` : null;
      const value = log.data ? BigInt(log.data) : 0n;

      if (
        from?.toLowerCase() === payer.toLowerCase() &&
        to?.toLowerCase()   === TREASURY.toLowerCase() &&
        value >= minAmount
      ) {
        // ── Tandai sebagai sudah dipakai di DB ───────────────────────────
        // Ditulis SETELAH on-chain konfirmasi berhasil.
        // ON CONFLICT DO NOTHING aman kalau ada race condition.
        const amountUsdc = Number(value) / 1e6;
        await markPaymentUsed(txHash, payer, amountUsdc);

        logger.info(`x402 payment recorded to DB: ${txHash}`);
        return true;
      }
    }

    return false;
  } catch (err) {
    logger.error("x402 verification failed", err);
    return false;
  }
}

/**
 * Fastify preHandler — attach to /api/chat route.
 *
 * Usage:
 *   app.post("/api/chat", { preHandler: x402PaymentGate }, handler)
 */
export async function x402PaymentGate(
  req:   FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paymentHeader = req.headers["x-payment"] as string | undefined;

  if (!paymentHeader) {
    return reply.code(402).send({
      error: "Payment Required",
      x402: {
        scheme:   "exact",
        network:  `eip155:${CHAIN_ID}`,
        asset:    USDC_ADDRESS,
        payTo:    TREASURY ?? "not_configured",
        amount:   CHAT_PRICE_USDC,
        decimals: 6,
        memo:     "piggy-sentinel-chat",
      },
    });
  }

  const parsed = parsePaymentHeader(paymentHeader);
  if (!parsed) {
    return reply.code(400).send({ error: "Invalid x-payment header format. Expected: txHash:payerAddress" });
  }

  const valid = await verifyPayment(parsed.txHash, parsed.payer);
  if (!valid) {
    return reply.code(402).send({ error: "Payment verification failed", txHash: parsed.txHash });
  }

  logger.info(`x402 payment verified: ${parsed.txHash} from ${parsed.payer}`);
}
