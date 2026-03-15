import { PrivyClient } from "@privy-io/server-auth";
import type { FastifyRequest, FastifyReply } from "fastify";
import { logger } from "@piggy/shared";

// ── Privy server client ──────────────────────────────────────────────────────
// PRIVY_APP_ID    = same as NEXT_PUBLIC_PRIVY_APP_ID used in frontend
// PRIVY_APP_SECRET = from Privy dashboard → Settings → API Keys
// Both must be set. Fail hard at startup rather than silently accepting all requests.

const PRIVY_APP_ID     = process.env.PRIVY_APP_ID;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET;

if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
  throw new Error(
    "[auth] PRIVY_APP_ID and PRIVY_APP_SECRET must be set in .env\n" +
    "  Get PRIVY_APP_SECRET from: Privy dashboard → Settings → API Keys"
  );
}

const privy = new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET);

// ── Type augmentation ────────────────────────────────────────────────────────
// Attach verified wallet to the request object after auth succeeds.
// Access via (req as AuthedRequest).verifiedWallet in route handlers.

export interface AuthedRequest extends FastifyRequest {
  verifiedWallet: string; // lowercase — always compare with .toLowerCase()
}

// ── requireAuth middleware ────────────────────────────────────────────────────
//
// Usage in route handlers:
//   app.post("/route", { preHandler: requireAuth }, async (req, reply) => {
//     const { verifiedWallet } = req as AuthedRequest;
//     // verifiedWallet is guaranteed to be the caller's actual wallet address
//   });
//
// Flow:
//   1. Extract Bearer token from Authorization header
//   2. Verify token signature with Privy (prevents forged tokens)
//   3. Look up the user's embedded wallet address from Privy
//   4. Attach to req.verifiedWallet
//
// Returns 401 on any failure — never falls through with an unverified identity.

export async function requireAuth(
  req: FastifyRequest & { verifiedWallet?: string },
  reply: FastifyReply,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Authorization required — include Bearer token" });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return reply.code(401).send({ error: "Empty Bearer token" });
  }

  try {
    // Step 1: Verify the token is valid and extract the Privy user ID.
    // This checks the JWT signature — a forged token will throw here.
    const claims = await privy.verifyAuthToken(token);

    // Step 2: Look up the user's linked wallet.
    // Privy embedded wallets have type="wallet", walletClientType="privy".
    // External wallets (MetaMask etc.) have walletClientType="metamask" or similar.
    // We accept both — any verified linked wallet counts as the owner address.
    const user = await privy.getUser(claims.userId);

    const linkedWallet = user.linkedAccounts.find(
      (a): a is Extract<typeof a, { type: "wallet" }> => a.type === "wallet"
    );

    if (!linkedWallet?.address) {
      logger.warn("auth: user has no linked wallet", { userId: claims.userId });
      return reply.code(401).send({ error: "No wallet linked to this Privy account" });
    }

    req.verifiedWallet = linkedWallet.address.toLowerCase();

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("auth: token verification failed", { error: msg });
    return reply.code(401).send({ error: "Invalid or expired token" });
  }
}

// ── assertOwns ───────────────────────────────────────────────────────────────
// Helper used inside route handlers to confirm the verified caller owns a goal.
// Returns the verified wallet address (already lowercased) for convenience.
//
// Usage:
//   const callerWallet = assertOwns(req, goal);
//   if (!callerWallet) return reply.code(403).send({ error: "not authorized" });

export function assertOwns(
  req: FastifyRequest & { verifiedWallet?: string },
  goalOwnerWallet: string,
): string | null {
  const caller = req.verifiedWallet;
  if (!caller) return null;
  if (caller !== goalOwnerWallet.toLowerCase()) return null;
  return caller;
}
