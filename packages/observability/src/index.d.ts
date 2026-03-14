export interface AgentEventInput {
    agentWalletAddress: string;
    skillName: string;
    eventType: string;
    txHash: string | null;
    metadata?: Record<string, unknown>;
}
export interface AgentEventResult {
    eventId: string | null;
    logged: boolean;
}
/**
 * Emit an agent lifecycle event to Agentscan.
 *
 * Fire-and-forget — errors are logged but never thrown,
 * so a failed observability call never blocks agent execution.
 */
export declare function emitAgentEvent(input: AgentEventInput): Promise<AgentEventResult>;
//# sourceMappingURL=index.d.ts.map