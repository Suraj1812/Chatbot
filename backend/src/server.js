import express from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { ZodError } from "zod";
import { createDb } from "./utils/db.js";
import { logger } from "./utils/logger.js";
import { KnowledgeEngine } from "./engine/knowledgeEngine.js";
import { createApiRouter } from "./routes/api.js";

const app = express();
const db = await createDb();
const engine = new KnowledgeEngine(db);
const scrapeState = { active: false };

function createRateLimiter({ windowMs = 60_000, max = 180 } = {}) {
  const buckets = new Map();
  setInterval(() => buckets.clear(), windowMs).unref();
  return (request, response, next) => {
    const key = request.ip || request.socket.remoteAddress || "local";
    const now = Date.now();
    const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (bucket.resetAt <= now) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }
    bucket.count += 1;
    buckets.set(key, bucket);

    response.setHeader("RateLimit-Limit", String(max));
    response.setHeader("RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      response.status(429).json({ error: "Too many requests. Please wait a moment and try again." });
      return;
    }
    next();
  };
}

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
if (process.env.DISABLE_RATE_LIMIT !== "true") app.use(createRateLimiter());
app.use(express.json({ limit: "1mb" }));
app.use(pinoHttp({ logger }));

app.use(createApiRouter({ engine, scrapeState }));

app.use((request, response) => {
  response.status(404).json({ error: "Route not found." });
});

app.use((error, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({ error: "Invalid request.", details: error.errors });
    return;
  }

  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    response.status(400).json({ error: "Invalid JSON body." });
    return;
  }

  if (error?.type === "entity.too.large") {
    response.status(413).json({ error: "Request body too large." });
    return;
  }

  request.log?.error({ error }, "request failed");
  response.status(500).json({ error: "Internal server error." });
});

const port = Number(process.env.PORT || 4000);
const server = app.listen(port, () => {
  logger.info(`Backend running at http://localhost:${port}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    logger.error(`Port ${port} is already in use. Stop the old server or run with PORT=${port + 1}.`);
    process.exit(1);
  }
  logger.error({ error }, "server failed");
  process.exit(1);
});

function shutdown(signal) {
  logger.info(`${signal} received. Closing backend.`);
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
