/**
 * agentscan emitter — never throws, never blocks execution.
 * Called after every confirmed on-chain action.
 */
import type { AgentEventType, SkillName } from "@piggy/shared";
import { CHAIN_ID } from "@piggy/config/chains";
import { logger } from "@piggy/shared";

const URL = process.env.AGENTSCAN_API_URL ?? "";
const KEY = process.env.AGENTSCAN_API_KEY ?? "";

export interface EmitPayload {
  agentWalletAddress: string;
  skillName:          SkillName;
  eventType:          AgentEventType;
  txHash:             string | null;
  metadata:           Record<string, unknown>;
}

export interface EmitResult {
  eventId:     string | null;
  explorerUrl: string | null;
}

export async function emitAgentEvent(payload: EmitPayload): Promise<EmitResult> {
  if (!URL || !KEY) {
    logger.warn("agentscan: not configured — logging locally", { event: payload.eventType });
    return { eventId: null, explorerUrl: null };
  }

  try {
    const res = await fetch(`${URL}/v1/events`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${KEY}` },
      body: JSON.stringify({ ...payload, chainId: CHAIN_ID, timestamp: new Date().toISOString() }),
    });

    if (!res.ok) {
      logger.warn(`agentscan: HTTP ${res.status}`);
      return { eventId: null, explorerUrl: null };
    }

    const data = await res.json() as { id?: string; url?: string };
    logger.info(`agentscan: event emitted`, { id: data.id, skill: payload.skillName });
    return { eventId: data.id ?? null, explorerUrl: data.url ?? null };
  } catch (err) {
    logger.error("agentscan: emit failed (non-blocking)", err);
    return { eventId: null, explorerUrl: null };
  }
}
