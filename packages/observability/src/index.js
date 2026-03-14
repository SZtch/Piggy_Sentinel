// ─────────────────────────────────────────────────────────────────────────────
// @piggy/observability — Agent Event Emitter
//
// Emits structured events to Agentscan (https://agentscan.io) for
// agent activity tracking and debugging.
//
// If AGENTSCAN_API_KEY is not set, events are logged locally only —
// the service continues normally (fire-and-forget).
// ─────────────────────────────────────────────────────────────────────────────
import { logger } from "@piggy/shared";
const AGENTSCAN_API = "https://api.agentscan.io/v1/events";
/**
 * Emit an agent lifecycle event to Agentscan.
 *
 * Fire-and-forget — errors are logged but never thrown,
 * so a failed observability call never blocks agent execution.
 */
export async function emitAgentEvent(input) {
    const apiKey = process.env.AGENTSCAN_API_KEY;
    const payload = {
        agentAddress: input.agentWalletAddress,
        skillName: input.skillName,
        eventType: input.eventType,
        txHash: input.txHash,
        timestamp: new Date().toISOString(),
        metadata: input.metadata ?? {},
    };
    // Always log locally
    logger.info("agentscan: event", {
        eventType: input.eventType,
        skill: input.skillName,
        agent: input.agentWalletAddress.slice(0, 10) + "...",
        txHash: input.txHash ?? "null",
    });
    if (!apiKey) {
        // Dev mode — log only, no HTTP call
        return { eventId: null, logged: true };
    }
    try {
        const res = await fetch(AGENTSCAN_API, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            logger.warn("agentscan: event POST failed", { status: res.status });
            return { eventId: null, logged: false };
        }
        const data = await res.json();
        return { eventId: data.eventId ?? null, logged: true };
    }
    catch (err) {
        // Network failure — never throw, just log
        logger.warn("agentscan: event POST threw", {
            err: err instanceof Error ? err.message : String(err),
        });
        return { eventId: null, logged: false };
    }
}
