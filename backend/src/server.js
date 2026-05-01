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

app.use(helmet());
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));
app.use(pinoHttp({ logger }));

app.use(createApiRouter({ engine, scrapeState }));

app.use((error, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({ error: "Invalid request.", details: error.errors });
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
app.listen(port, () => {
  logger.info(`Backend running at http://localhost:${port}`);
});
