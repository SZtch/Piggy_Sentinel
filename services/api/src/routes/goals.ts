import type { FastifyInstance } from "fastify";
import {
  upsertUser, upsertAgentWallet, createGoal, getGoalById,
  getActiveGoalByOwner, updateGoalStatus, getAllActiveGoals,
  getRecentHistory, insertExecution, updateExecution, setSoftPausedByOwner, setSoftPausedById,
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
import { requireAuth, assertOwns, type AuthedRequest } from "../middleware/auth.js";
import { requireInternalSecret }  from "../middleware/internalAuth.js";
import { createPublicClient, http } from "viem";
import { activeChain }            from "@piggy/config/chains";

export async function goalsRoutes(app: FastifyInstance) {

  // ── Read endpoints (auth required — return only the caller's own data) ─────
  //
  // Previously these accepted an arbitrary ?wallet= query param with no
  // verification. Any attacker knowing a victim's wallet address could read
  // their full goal history and current status.
  //
  // Fix: require a valid Privy Bearer token. The wallet address is taken from
  // the verified token, NOT from the query param. The query param is ignored.

  // GET /api/goals/status
  app.get(
    "/status",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { verifiedWallet } = req as AuthedRequest;
      const goal = await getActiveGoalByOwner(verifiedWallet);
      return goal ?? { status: "no_active_goal" };
    }
  );

  // GET /api/goals/history
  app.get(
    "/history",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { verifiedWallet } = req as AuthedRequest;
      return getRecentHistory(verifiedWallet);
    }
  );

  // GET /api/goals/all
  app.get(
    "/all",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { verifiedWallet } = req as AuthedRequest;
      const { goals } = await getRecentHistory(verifiedWallet);
      return goals;
    }
  );

  // POST /api/goals/create
  // ownerWallet is taken from the verified token — the request body value is
  // ignored and overwritten. This prevents a user from creating a goal on
  // behalf of another wallet.
  app.post<{ Body: {
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
    // ownerWallet intentionally NOT accepted from body —
    // sourced from verifiedWallet only.
  } }>(
    "/create",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { verifiedWallet } = req as AuthedRequest;
      const {
        agentWalletAddress, targetAmount,
        targetCurrency, deadlineDate, spendLimit,
      } = req.body;

      if (!agentWalletAddress || !targetAmount || !targetCurrency || !deadlineDate) {
        return reply.code(400).send({ error: "missing required fields" });
      }

      try {
        await upsertUser(verifiedWallet);
        await upsertAgentWallet({
          contractAddress: agentWalletAddress,
          ownerWallet:     verifiedWallet,
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
          ownerWallet:    verifiedWallet,
          agentWallet:    agentWalletAddress,
          targetAmount:   BigInt(targetAmount),
          targetCurrency,
          deadlineDate:   new Date(deadlineDate),
          strategyJson:   stratResult.data,
        });

        logger.info("goal created", { id: goal[0]?.id, wallet: verifiedWallet });
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
    }
  );

  // POST /api/goals/:id/activate
  app.post<{ Params: { id: string }; Body: { baselineFxRate?: number } }>(
    "/:id/activate",
    { preHandler: requireAuth },
    async (req, reply) => {
      const goal = await getGoalById(req.params.id);
      if (!goal) return reply.code(404).send({ error: "goal not found" });

      if (!assertOwns(req as AuthedRequest, goal.ownerWallet)) {
        return reply.code(403).send({ error: "not authorized" });
      }

      if (goal.status !== "draft")
        return reply.code(400).send({ error: `cannot activate from status: ${goal.status}` });

      // B3 FIX: verifikasi user sudah call registerGoal() on-chain sebelum activate.
      // Versi lama: langsung activate tanpa cek — agent cycle langsung jalan,
      // allowance check gagal, goal langsung masuk action_required yang membingungkan.
      // Fix: cek principalDeposited on-chain. Kalau 0, user belum registerGoal.
      try {
        const positionsAbi = [{ name: "positions", type: "function", inputs: [{ name: "", type: "address" }], outputs: [{ name: "principalDeposited", type: "uint256" }, { name: "lastRebalancedAt", type: "uint256" }, { name: "userPaused", type: "bool" }, { name: "goalTarget", type: "uint256" }, { name: "goalDeadline", type: "uint256" }, { name: "spendLimit", type: "uint256" }, { name: "cumulativeSpent", type: "uint256" }, { name: "epochStart", type: "uint256" }], stateMutability: "view" }] as const;
        const executorAddr = getDeployedAddress(CHAIN_ID, "sentinelExecutor") as `0x${string}`;
        const client = createPublicClient({ chain: activeChain, transport: http() });
        const pos = await client.readContract({
          address: executorAddr, abi: positionsAbi,
          functionName: "positions", args: [goal.ownerWallet as `0x${string}`],
        });
        if (pos[0] === 0n) {
          return reply.code(400).send({
            error: "registerGoal not found on-chain. Please call registerGoal() on the contract first.",
            code:  "REGISTER_GOAL_REQUIRED",
          });
        }
      } catch (err) {
        // RPC error — jangan block aktivasi, log saja dan lanjut
        logger.warn("activate: on-chain position check failed — proceeding", err as object);
      }

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
  app.post<{ Params: { id: string } }>(
    "/:id/pause",
    { preHandler: requireAuth },
    async (req, reply) => {
      const goal = await getGoalById(req.params.id);
      if (!goal) return reply.code(404).send({ error: "goal not found" });

      if (!assertOwns(req as AuthedRequest, goal.ownerWallet)) {
        return reply.code(403).send({ error: "not authorized" });
      }

      await setSoftPausedById(req.params.id, true);
      await updateGoalStatus(req.params.id, "paused");
      await emitAgentEvent({
        agentWalletAddress: goal.agentWallet,
        skillName:  "handlePauseResume",
        eventType:  "AGENT_PAUSED",
        txHash:     null,
        metadata:   { goalId: req.params.id },
      });
      return { goalId: req.params.id, status: "paused" };
    }
  );

  // POST /api/goals/:id/resume
  app.post<{ Params: { id: string } }>(
    "/:id/resume",
    { preHandler: requireAuth },
    async (req, reply) => {
      const goal = await getGoalById(req.params.id);
      if (!goal) return reply.code(404).send({ error: "goal not found" });

      if (!assertOwns(req as AuthedRequest, goal.ownerWallet)) {
        return reply.code(403).send({ error: "not authorized" });
      }

      await setSoftPausedById(req.params.id, false);
      await updateGoalStatus(req.params.id, "active");
      await emitAgentEvent({
        agentWalletAddress: goal.agentWallet,
        skillName:  "handlePauseResume",
        eventType:  "AGENT_RESUMED",
        txHash:     null,
        metadata:   { goalId: req.params.id },
      });
      return { goalId: req.params.id, status: "active" };
    }
  );

  // POST /api/goals/:id/withdraw
  app.post<{ Params: { id: string }; Body: { txHash?: string } }>(
    "/:id/withdraw",
    { preHandler: requireAuth },
    async (req, reply) => {
      const goal = await getGoalById(req.params.id);
      if (!goal) return reply.code(404).send({ error: "goal not found" });

      if (!assertOwns(req as AuthedRequest, goal.ownerWallet)) {
        return reply.code(403).send({ error: "not authorized" });
      }

      if (!["active", "paused", "action_required", "completed", "expired"].includes(goal.status))
        return reply.code(400).send({ error: `cannot withdraw from status: ${goal.status}` });

      await setSoftPausedById(req.params.id, true);
      await updateGoalStatus(req.params.id, "paused");

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
    }
  );

  // POST /api/goals/:id/reactivate
  app.post<{ Params: { id: string } }>(
    "/:id/reactivate",
    { preHandler: requireAuth },
    async (req, reply) => {
      const goal = await getGoalById(req.params.id);
      if (!goal) return reply.code(404).send({ error: "goal not found" });

      if (!assertOwns(req as AuthedRequest, goal.ownerWallet)) {
        return reply.code(403).send({ error: "not authorized" });
      }

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
    }
  );

  // GET /api/goals/:id/agent-status
  app.get<{ Params: { id: string } }>(
    "/:id/agent-status",
    { preHandler: requireAuth },
    async (req, reply) => {
      const goal = await getGoalById(req.params.id);
      if (!goal) return reply.code(404).send({ error: "goal not found" });

      if (!assertOwns(req as AuthedRequest, goal.ownerWallet)) {
        return reply.code(403).send({ error: "not authorized" });
      }

      const latest = await getLatestAgentEvent(req.params.id);
      const recent = await getRecentAgentEvents(req.params.id, 5);
      return { latest: latest ?? null, recent };
    }
  );

  // POST /api/goals/:id/complete-action
  app.post<{ Params: { id: string }; Body: { action: "withdraw" | "continue" | "new_goal" } }>(
    "/:id/complete-action",
    { preHandler: requireAuth },
    async (req, reply) => {
      const goal = await getGoalById(req.params.id);
      if (!goal) return reply.code(404).send({ error: "goal not found" });

      if (!assertOwns(req as AuthedRequest, goal.ownerWallet)) {
        return reply.code(403).send({ error: "not authorized" });
      }

      if (goal.status !== "completed")
        return reply.code(400).send({ error: "goal is not completed" });

      const { action } = req.body;

      if (action === "withdraw") {
        await setSoftPausedById(req.params.id, true);
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
        logger.info("goal completed — user chose to continue", { id: req.params.id });
        return { goalId: req.params.id, action: "continue" };
      }

      if (action === "new_goal") {
        await updateGoalStatus(req.params.id, "cancelled");
        return { goalId: req.params.id, action: "new_goal" };
      }

      return reply.code(400).send({ error: "invalid action" });
    }
  );

  // GET /api/goals/all-active  (INTERNAL — scheduler only)
  // Previously unauthenticated and public — exposed all active users' wallet
  // addresses. Now protected with x-internal-secret header.
  app.get(
    "/all-active",
    { preHandler: requireInternalSecret },
    async () => getAllActiveGoals()
  );
}
