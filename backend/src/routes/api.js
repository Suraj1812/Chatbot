import express from "express";
import { z } from "zod";
import { scrapeUrls } from "../services/scraper.js";
import { searchWeb } from "../services/webSearch.js";

const askSchema = z.object({
  query: z.string().trim().min(1).max(1000)
});

const scrapeSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  depth: z.boolean().optional().default(false),
  maxPages: z.number().int().min(1).max(25).optional().default(10)
});

const learnSchema = z.object({
  text: z.string().trim().min(1).max(100000),
  title: z.string().trim().min(1).max(200).optional(),
  source: z.string().trim().min(1).max(500).optional()
});

const feedbackSchema = z.object({
  query: z.string().trim().min(1).max(1000),
  answer: z.string().trim().min(1).max(100000),
  rating: z.enum(["good", "bad"])
});

function parseUrls(value) {
  const urls = Array.isArray(value) ? value : value.split(/\n|,/);
  return [...new Set(urls.map((url) => url.trim()).filter(Boolean))].slice(0, 10);
}

export function createApiRouter({ engine, scrapeState }) {
  const router = express.Router();

  router.get("/health", (request, response) => {
    response.json({
      ok: true,
      documents: engine.db.data.documents.length,
      facts: engine.db.data.facts.length,
      approvedAnswers: engine.db.data.approvedAnswers.length,
      scrapeInProgress: scrapeState.active
    });
  });

  router.post("/ask", async (request, response) => {
    const input = askSchema.parse(request.body);
    const localAnswer = await engine.ask(input.query);
    if (localAnswer.intent === "conversation" || localAnswer.confidence >= 0.45) {
      response.json(localAnswer);
      return;
    }

    if (scrapeState.active) {
      response.json({ ...localAnswer, research: { attempted: false, reason: "Scraping is already running." } });
      return;
    }

    scrapeState.active = true;
    try {
      const searchResults = await searchWeb(input.query, { limit: 8 });
      const result = await scrapeUrls(searchResults.map((item) => item.source), {
        depth: 0,
        maxPages: 8
      });
      if (result.documents.length) {
        await engine.addScrapedDocuments(result.documents);
      }
      const researchedAnswer = await engine.ask(input.query);
      response.json({
        ...researchedAnswer,
        research: {
          attempted: true,
          searched: searchResults.length,
          scraped: result.documents.length,
          errors: result.errors
        }
      });
    } catch (error) {
      response.json({
        ...localAnswer,
        research: {
          attempted: true,
          searched: 0,
          scraped: 0,
          errors: [{ error: error.message }]
        }
      });
    } finally {
      scrapeState.active = false;
    }
  });

  router.post("/learn", async (request, response) => {
    const input = learnSchema.parse(request.body);
    const document = await engine.learn({
      text: input.text,
      title: input.title || "Manual learning",
      source: input.source || "manual"
    });
    response.json({ ok: true, document });
  });

  router.post("/scrape", async (request, response) => {
    if (scrapeState.active) {
      response.status(409).json({ error: "Scraping is already running." });
      return;
    }

    const input = scrapeSchema.parse(request.body);
    const urls = parseUrls(input.urls);
    if (!urls.length) {
      response.status(400).json({ error: "At least one URL is required." });
      return;
    }

    scrapeState.active = true;
    try {
      const result = await scrapeUrls(urls, {
        depth: input.depth ? 1 : 0,
        maxPages: input.maxPages
      });
      const saved = await engine.addScrapedDocuments(result.documents);
      response.json({
        ok: true,
        scraped: result.documents.length,
        added: saved.added,
        total: saved.total,
        errors: result.errors
      });
    } finally {
      scrapeState.active = false;
    }
  });

  router.post("/feedback", async (request, response) => {
    const input = feedbackSchema.parse(request.body);
    const feedback = await engine.addFeedback(input);
    response.json({ ok: true, feedback });
  });

  return router;
}
