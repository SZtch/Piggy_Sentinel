/**
 * Piggy Sentinel — Scheduler
 *
 * One job per active goal, running every 6 hours.
 * Replaces the old separate fx-check + progress jobs with a unified cycle.
 */
import { Queue, Worker } from "bullmq";
import { getAllActiveGoals } from "@piggy/db";
import { logger }           from "@piggy/shared";
import { AGENT_CYCLE_INTERVAL_MS } from "@piggy/shared";
import { CHAIN_ID, IS_MAINNET }    from "@piggy/config/chains";
import { runGoalCycle }            from "./jobs/runGoalCycle.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const [host, portStr] = REDIS_URL.replace("redis://", "").split(":");
const REDIS = { host, port: parseInt(portStr ?? "6379") };

export const agentQueue = new Queue("agent-cycle", { connection: REDIS });

const worker = new Worker(
  "agent-cycle",
  async (job) => {
    logger.info(`[scheduler] cycle start — goal ${job.data.goalId}`);
    await runGoalCycle(job.data.goalId);
  },
  {
    connection:  REDIS,
    concurrency: 5,   // max 5 goals in parallel
  },
);

worker.on("failed",    (job, err) => logger.error(`[scheduler] failed: ${job?.data.goalId}`, err.message));
worker.on("completed", (job)      => logger.info(`[scheduler] done: ${job.data.goalId}`));

async function scheduleActive() {
  const goals = await getAllActiveGoals();
  logger.info(`[scheduler] scheduling ${goals.length} active goals | chain ${CHAIN_ID} | ${IS_MAINNET ? "⚠️ MAINNET" : "Sepolia"}`);

  for (const goal of goals) {
    const jobId = `agent-cycle:${goal.id}`;
    await agentQueue.add(
      jobId,
      { goalId: goal.id },
      {
        jobId,
        repeat: { every: AGENT_CYCLE_INTERVAL_MS },
        removeOnComplete: 20,
        removeOnFail:     10,
      },
    );
  }
}

async function main() {
  logger.info("[scheduler] starting");
  await scheduleActive();
  // Re-check for new goals every 5 minutes
  setInterval(scheduleActive, 5 * 60 * 1000);
}

main().catch(err => { logger.error("[scheduler] fatal", err); process.exit(1); });
