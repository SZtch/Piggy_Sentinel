import type { FastifyInstance } from "fastify";
import {
  upsertUser, upsertAgentWallet, createGoal, getGoalById,
  getActiveGoalByOwner, updateGoalStatus, getAllActiveGoals,
  getRecentHistory, insertExecution, updateExecution, setSoftPausedByOwner,
  setGoalActionRequired, clearGoalActionRequired,
  getLatestAgentEvent, getRecentAgentEvents,
} from "@piggy/db";
import { computeSavingsStrategy } from "@piggy/skills";
import { emitAgentEvent }         from "@piggy/observability";
import { logger }                 from "@piggy/shared";
import { calcApprovalAmount }     from "@piggy/shared";
import { CHAIN_ID }               from "@piggy/config/chains";
import { getTokenAddress }        from "@piggy/config/tokens";
import { getDeployedAddress }     from "@piggy/config/contracts";

export async function goalsRoutes(app: FastifyInstance) {

  // GET /api/goals/status?wallet=0x...
  app.get<{ Querystring: { wallet: string } }>("/status", async (req, reply) => {
    const { wallet } = req.query;
    if (!wallet) return reply.code(400).send({ error: "wallet required" });
    const goal = await getActiveGoalByOwner(wallet);
    return goal ?? { status: "no_active_goal" };
  });

  // GET /api/goals/history?wallet=0x...
  app.get<{ Querystring: { wallet: string } }>("/history", async (req, reply) => {
    const { wallet } = req.query;
    if (!wallet) return reply.code(400).send({ error: "wallet required" });
    return getRecentHistory(wallet);
  });

  // GET /api/goals/all?wallet=0x...  — all goals across all statuses
  app.get<{ Querystring: { wallet: string } }>("/all", async (req, reply) => {
    const { wallet } = req.query;
    if (!wallet) return reply.code(400).send({ error: "wallet required" });
    const { goals } = await getRecentHistory(wallet);
    return goals;
  });

  // POST /api/goals/create
  app.post<{ Body: {
    ownerWallet:         string;
    agentWalletAddress:  string;
    targetAmount:        string;
    targetCurrency:      string;
    deadlineDate:        string;
    spendLimit?:         string;
    maxPerExecution?:    string;
    maxPerWeek?:         string;
    weeklyContribution?: string;
    contributionPattern?:"recurring" | "manual";
    goalName?:           string;
  } }>("/create", async (req, reply) => {
    const {
      ownerWallet, agentWalletAddress, targetAmount,
      targetCurrency, deadlineDate, spendLimit,
    } = req.body;

    if (!ownerWallet || !agentWalletAddress || !targetAmount || !targetCurrency || !deadlineDate) {
      return reply.code(400).send({ error: "missing required fields" });
    }

    try {
      await upsertUser(ownerWallet);
      await upsertAgentWallet({
        contractAddress: agentWalletAddress,
        ownerWallet,
        executorAddress: getDeployedAddress(CHAIN_ID, "sentinelExecutor"),
        spendLimit:      spendLimit ? BigInt(spendLimit) : calcApprovalAmount(BigInt(targetAmount)),
      });

      const stratResult = await computeSavingsStrategy({
        targetAmount:   BigInt(targetAmount),
        targetCurrency,
        deadlineDays:   Math.ceil((new Date(deadlineDate).getTime() - Date.now()) / 86_400_000),
        walletBalance:  BigInt(targetAmount),
        useOpenClaw:    process.env.USE_OPENCLAW_STRATEGY === "true",
      });

      const goal = await createGoal({
        ownerWallet,
        agentWallet:    agentWalletAddress,
        targetAmount:   BigInt(targetAmount),
        targetCurrency,
        deadlineDate:   new Date(deadlineDate),
        strategyJson:   stratResult.data,
      });

      logger.info("goal created", { id: goal[0]?.id });
      return {
        goal:           goal[0],
        strategy:       stratResult.data,
        approvalAmount: calcApprovalAmount(BigInt(targetAmount)).toString(),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("create goal failed", msg);
      return reply.code(500).send({ error: msg });
    }
  });

  // POST /api/goals/:id/activate
  app.post<{ Params: { id: string }; Body: { baselineFxRate?: number } }>(
    "/:id/activate",
    async (req, reply) => {
      const goal = await getGoalById(req.params.id);
      if (!goal) return reply.code(404).send({ error: "goal not found" });
      if (goal.status !== "draft")
        return reply.code(400).send({ error: `cannot activate from status: ${goal.status}` });

      await updateGoalStatus(req.params.id, "active");

      const execId = await insertExecution({
        goalId:      req.params.id,
        agentWallet: goal.agentWallet,
        skillName:   "allocateSavings",
        status:      "pending",
      });

      await emitAgentEvent({
        agentWalletAddress: goal.agentWallet,
        skillName:  "emitAgentEvent",
        eventType:  "GOAL_ACTIVATED",
        txHash:     null,
        metadata:   { goalId: req.params.id, targetAmount: goal.targetAmount, currency: goal.targetCurrency },
      });

      logger.info("goal activated", { id: req.params.id });
      return { goalId: req.params.id, execId, status: "active" };
    }
  );

  // POST /api/goals/:id/pause
  app.post<{ Params: { id: string } }>("/:id/pause", async (req, reply) => {
    const goal = await getGoalById(req.params.id);
    if (!goal) return reply.code(404).send({ error: "goal not found" });
    await setSoftPausedByOwner(goal.ownerWallet, true);
    await updateGoalStatus(req.params.id, "paused");
    await emitAgentEvent({
      agentWalletAddress: goal.agentWallet,
      skillName:  "handlePauseResume",
      eventType:  "AGENT_PAUSED",
      txHash:     null,
      metadata:   { goalId: req.params.id },
    });
    return { goalId: req.params.id, status: "paused" };
  });

  // POST /api/goals/:id/resume
  app.post<{ Params: { id: string } }>("/:id/resume", async (req, reply) => {
    const goal = await getGoalById(req.params.id);
    if (!goal) return reply.code(404).send({ error: "goal not found" });
    await setSoftPausedByOwner(goal.ownerWallet, false);
    await updateGoalStatus(req.params.id, "active");
    await emitAgentEvent({
      agentWalletAddress: goal.agentWallet,
      skillName:  "handlePauseResume",
      eventType:  "AGENT_RESUMED",
      txHash:     null,
      metadata:   { goalId: req.params.id },
    });
    return { goalId: req.params.id, status: "active" };
  });

  // POST /api/goals/:id/withdraw
  // Called by the FRONTEND after the user's wallet has already executed
  // SentinelExecutor.withdraw() on-chain. This endpoint just updates the DB state.
  // The actual on-chain withdrawal is performed by the user's wallet directly —
  // not by the agent — because contract.withdraw() requires msg.sender = userWallet.
  app.post<{ Params: { id: string }; Body: { txHash?: string } }>("/:id/withdraw", async (req, reply) => {
    const goal = await getGoalById(req.params.id);
    if (!goal) return reply.code(404).send({ error: "goal not found" });
    if (!["active", "paused", "action_required", "completed", "expired"].includes(goal.status))
      return reply.code(400).send({ error: `cannot withdraw from status: ${goal.status}` });

    // Stop the agent immediately
    await setSoftPausedByOwner(goal.ownerWallet, true);
    await updateGoalStatus(req.params.id, "paused");

    // Log the withdrawal as a confirmed execution (on-chain tx was done by user)
    const txHash = req.body?.txHash ?? null;
    const execId = await insertExecution({
      goalId:      req.params.id,
      agentWallet: goal.agentWallet,
      skillName:   "withdrawAll",
      status:      txHash ? "confirmed" : "pending",
    });

    if (txHash) {
      await updateExecution(execId, "confirmed", txHash);
    }

    await emitAgentEvent({
      agentWalletAddress: goal.agentWallet,
      skillName:  "withdrawAll",
      eventType:  "GOAL_WITHDRAW_COMPLETED",
      txHash:     txHash ?? null,
      metadata:   { goalId: req.params.id },
    });

    logger.info("withdraw recorded", { id: req.params.id, txHash });
    return { goalId: req.params.id, execId, status: "paused" };
  });

  // POST /api/goals/:id/reactivate — user re-approved allowance, clear action_required
  app.post<{ Params: { id: string } }>("/:id/reactivate", async (req, reply) => {
    const goal = await getGoalById(req.params.id);
    if (!goal) return reply.code(404).send({ error: "goal not found" });
    if (goal.status !== "action_required")
      return reply.code(400).send({ error: `cannot reactivate from status: ${goal.status}` });

    await clearGoalActionRequired(req.params.id);
    await emitAgentEvent({
      agentWalletAddress: goal.agentWallet,
      skillName:  "handleReactivate",
      eventType:  "GOAL_REACTIVATED",
      txHash:     null,
      metadata:   { goalId: req.params.id },
    });
    logger.info("goal reactivated", { id: req.params.id });
    return { goalId: req.params.id, status: "active" };
  });

  // GET /api/goals/:id/agent-status — latest agent cycle status
  app.get<{ Params: { id: string } }>("/:id/agent-status", async (req, reply) => {
    const latest = await getLatestAgentEvent(req.params.id);
    const recent = await getRecentAgentEvents(req.params.id, 5);
    return { latest: latest ?? null, recent };
  });

  // POST /api/goals/:id/complete-action — what to do after goal completes
  // body: { action: "withdraw" | "continue" | "new_goal" }
  app.post<{ Params: { id: string }; Body: { action: "withdraw" | "continue" | "new_goal" } }>(
    "/:id/complete-action",
    async (req, reply) => {
      const goal = await getGoalById(req.params.id);
      if (!goal) return reply.code(404).send({ error: "goal not found" });
      if (goal.status !== "completed")
        return reply.code(400).send({ error: "goal is not completed" });

      const { action } = req.body;

      if (action === "withdraw") {
        // Trigger withdraw flow (same as /withdraw route)
        await setSoftPausedByOwner(goal.ownerWallet, true);
        await updateGoalStatus(req.params.id, "paused");
        const execId = await insertExecution({
          goalId:      req.params.id,
          agentWallet: goal.agentWallet,
          skillName:   "withdrawAll",
          status:      "pending",
        });
        return { goalId: req.params.id, action: "withdraw", execId };
      }

      if (action === "continue") {
        // Keep goal active, keep earning yield — just log the choice
        logger.info("goal completed — user chose to continue", { id: req.params.id });
        return { goalId: req.params.id, action: "continue" };
      }

      if (action === "new_goal") {
        // Cancel the completed goal so user can create a fresh one
        await updateGoalStatus(req.params.id, "cancelled");
        return { goalId: req.params.id, action: "new_goal" };
      }

      return reply.code(400).send({ error: "invalid action" });
    }
  );

  // GET /api/goals/all-active  (internal scheduler use)
  app.get("/all-active", async () => getAllActiveGoals());
}
