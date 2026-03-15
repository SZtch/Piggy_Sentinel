import Fastify   from "fastify";
import cors      from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { logger } from "@piggy/shared";
import { getAgentBalance, getAgentAddress } from "@piggy/agent";
import { CHAIN_ID, IS_MAINNET } from "@piggy/config/chains";
import { goalsRoutes }  from "./routes/goals.js";
import { telegramRoutes } from "./routes/telegram.js";
import { chatRoutes }   from "./routes/chat.js";

const app  = Fastify({ logger: false });
const PORT = parseInt(process.env.API_PORT ?? "3001");

async function start() {
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
    : ["http://localhost:3000"];

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.some(o => origin.startsWith(o))) {
        cb(null, true);
      } else {
        cb(new Error("Not allowed by CORS"), false);
      }
    },
    credentials: true,
  });

  // Rate limiting — protect all routes
  await app.register(rateLimit, {
    global:    true,
    max:       60,        // 60 requests per minute per IP
    timeWindow: "1 minute",
    errorResponseBuilder: () => ({
      error: "Too many requests — slow down",
      retryAfter: 60,
    }),
  });

  app.get("/health", async () => {
    let agentBalance = "unknown";
    try { agentBalance = (await getAgentBalance()).toString(); } catch {}
    return {
      status:       "ok",
      appEnv:       process.env.APP_ENV ?? "dev",
      chainId:      CHAIN_ID,
      network:      IS_MAINNET ? "mainnet" : "sepolia",
      agent:        await getAgentAddress(),
      agentBalance,
    };
  });

  await app.register(goalsRoutes,    { prefix: "/api/goals"    });
  await app.register(telegramRoutes, { prefix: "/api/telegram" });
  await app.register(chatRoutes,     { prefix: "/api/chat"     });

  await app.listen({ port: PORT, host: "0.0.0.0" });
  logger.info(`API on :${PORT} | chain ${CHAIN_ID} | ${IS_MAINNET ? "⚠️  MAINNET" : "Sepolia"}`);
}

start().catch((err) => { logger.error("API failed to start", err); process.exit(1); });
