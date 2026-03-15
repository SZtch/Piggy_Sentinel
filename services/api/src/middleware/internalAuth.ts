import type { FastifyRequest, FastifyReply } from "fastify";
import { logger } from "@piggy/shared";

// ── Internal API secret ──────────────────────────────────────────────────────
// Used to protect endpoints that are called by backend services (scheduler,
// cron jobs) rather than by users via the frontend. These callers have no
// Privy session — they authenticate with a shared secret instead.
//
// Set INTERNAL_API_SECRET to a long random string (min 32 chars).
// Generate with: openssl rand -hex 32
//
// Callers must include header:
//   x-internal-secret: <INTERNAL_API_SECRET>

const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET;

if (!INTERNAL_SECRET || INTERNAL_SECRET.length < 32) {
  throw new Error(
    "[internalAuth] INTERNAL_API_SECRET must be set and >= 32 chars.\n" +
    "  Generate with: openssl rand -hex 32"
  );
}

export async function requireInternalSecret(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const provided = req.headers["x-internal-secret"];

  if (!provided || provided !== INTERNAL_SECRET) {
    logger.warn("internalAuth: invalid or missing x-internal-secret", {
      ip: req.ip,
      path: req.url,
    });
    // Return 404, not 403 — don't reveal the endpoint exists to attackers
    return reply.code(404).send({ error: "Not found" });
  }
}
