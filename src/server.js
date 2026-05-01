import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createChatEngine } from "./index.js";
import { scrapeUrls } from "./scraper.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const dataDir = path.join(root, "data");
const localDataPath = path.join(dataDir, "local-scraped-data.json");
const memoryPath = path.join(dataDir, "knowledge-memory.json");
const historyPath = path.join(dataDir, "query-history.json");
const maxBodyBytes = 1_000_000;
const maxUrlsPerScrape = 10;
const maxPagesPerScrape = 20;

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

function loadLocalData() {
  const parsed = readJsonFile(localDataPath, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item) => !String(item?.source || "").startsWith("sample/"));
}

function saveLocalData(data) {
  writeJsonFile(localDataPath, data);
}

function loadMemory() {
  const memory = readJsonFile(memoryPath, { topics: [], facts: [], summaries: [], feedback: [] });
  const facts = Array.isArray(memory.facts)
    ? memory.facts.filter((fact) => !String(fact?.source || "").startsWith("sample/"))
    : [];
  const summaries = Array.isArray(memory.summaries)
    ? memory.summaries.filter((summary) => !String(summary?.source || "").startsWith("sample/"))
    : [];

  return {
    topics: [...new Set([...facts.map((fact) => fact.topic), ...summaries.map((summary) => summary.topic)].filter(Boolean))],
    facts,
    summaries,
    feedback: Array.isArray(memory.feedback) ? memory.feedback : []
  };
}

function saveMemory() {
  writeJsonFile(memoryPath, engine.knowledgeBase.toJSON());
}

function loadHistory() {
  const history = readJsonFile(historyPath, []);
  return Array.isArray(history) ? history : [];
}

function saveHistory(history) {
  writeJsonFile(historyPath, history.slice(-200));
}

function mergeScrapedData(existing, incoming) {
  const merged = existing.map((item) => ({ ...item }));
  const indexes = new Map(merged.map((item, index) => [`${item.source}::${item.title}`.toLowerCase(), index]));

  for (const item of incoming) {
    const key = `${item.source}::${item.title}`.toLowerCase();
    if (indexes.has(key)) {
      const index = indexes.get(key);
      if (merged[index].contentHash !== item.contentHash || merged[index].content !== item.content) {
        merged[index] = item;
      }
      continue;
    }
    indexes.set(key, merged.length);
    merged.push(item);
  }

  return merged;
}

function validateScrapedData(data) {
  if (!Array.isArray(data)) return "Expected scraped_data to be an array.";
  for (const [index, item] of data.entries()) {
    if (!item || typeof item !== "object") return `Item ${index + 1} must be an object.`;
    if (typeof item.title !== "string") return `Item ${index + 1} needs a string title.`;
    if (typeof item.content !== "string") return `Item ${index + 1} needs string content.`;
    if (typeof item.source !== "string") return `Item ${index + 1} needs a string source.`;
  }
  return "";
}

let scrapedData = loadLocalData();
let queryHistory = loadHistory();
let engine = createChatEngine(scrapedData, { initialKnowledge: loadMemory() });
let scrapeInProgress = false;

function rebuildEngine({ learnAll = false } = {}) {
  const memory = engine.knowledgeBase.toJSON();
  engine = createChatEngine(scrapedData, { initialKnowledge: memory });
  if (learnAll) {
    engine.knowledgeBase.learnFromResults(engine.cleanedData.map((item) => ({ item, score: 1 })));
    saveMemory();
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBodyBytes) {
        request.destroy();
        reject(new Error("Request body too large."));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function readJsonRequest(request) {
  const body = await readBody(request);
  if (!body.trim()) return {};
  try {
    return JSON.parse(body);
  } catch {
    const error = new Error("Invalid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function routePath(request) {
  return new URL(request.url, "http://localhost").pathname;
}

function parseUrls(value) {
  const urls = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/\n|,/)
        .map((url) => url.trim())
        .filter(Boolean);

  return [...new Set(urls)].slice(0, maxUrlsPerScrape);
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function isRoute(pathname, routes) {
  return routes.includes(pathname);
}

const server = http.createServer(async (request, response) => {
  const pathname = routePath(request);

  try {
    if (request.method === "GET" && pathname === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(fs.readFileSync(path.join(publicDir, "index.html"), "utf8"));
      return;
    }

    if (request.method === "GET" && pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        sources: scrapedData.length,
        facts: engine.knowledgeBase.facts.length,
        history: queryHistory.length,
        scrapeInProgress
      });
      return;
    }

    if (request.method === "GET" && isRoute(pathname, ["/data", "/api/data"])) {
      sendJson(response, 200, { scrapedData, knowledgeBase: engine.knowledgeBase.toJSON(), history: queryHistory });
      return;
    }

    if (request.method === "POST" && isRoute(pathname, ["/data", "/api/data"])) {
      const payload = await readJsonRequest(request);
      const validationError = validateScrapedData(payload.scraped_data);
      if (validationError) {
        sendJson(response, 400, { error: validationError });
        return;
      }
      scrapedData = payload.scraped_data;
      saveLocalData(scrapedData);
      rebuildEngine({ learnAll: true });
      sendJson(response, 200, { ok: true, count: scrapedData.length });
      return;
    }

    if (request.method === "POST" && isRoute(pathname, ["/learn", "/api/learn"])) {
      const payload = await readJsonRequest(request);
      const text = String(payload.text || "").trim();
      if (!text) {
        sendJson(response, 400, { error: "Add text to learn." });
        return;
      }

      engine.knowledgeBase.learnFromText(text, payload.source || "local-note", payload.topic || "Local Note");
      engine.cache.clear();
      saveMemory();
      sendJson(response, 200, { ok: true, facts: engine.knowledgeBase.facts.length });
      return;
    }

    if (request.method === "POST" && isRoute(pathname, ["/scrape", "/api/scrape"])) {
      if (scrapeInProgress) {
        sendJson(response, 409, { error: "Scraping is already running." });
        return;
      }

      const payload = await readJsonRequest(request);
      const urls = parseUrls(payload.urls);

      if (urls.length === 0) {
        sendJson(response, 400, { error: "Add at least one URL." });
        return;
      }

      scrapeInProgress = true;
      try {
        const result = await scrapeUrls(urls, {
          depth: payload.depth ? 1 : 0,
          maxPages: boundedNumber(payload.maxPages, 10, 1, maxPagesPerScrape)
        });
        const beforeCount = scrapedData.length;
        scrapedData = mergeScrapedData(scrapedData, result.scraped);
        saveLocalData(scrapedData);
        rebuildEngine({ learnAll: true });
        sendJson(response, 200, {
          ok: true,
          added: scrapedData.length - beforeCount,
          scraped: result.scraped.length,
          count: scrapedData.length,
          errors: result.errors
        });
      } finally {
        scrapeInProgress = false;
      }
      return;
    }

    if (request.method === "POST" && isRoute(pathname, ["/reset", "/api/reset"])) {
      scrapedData = [];
      queryHistory = [];
      saveLocalData(scrapedData);
      saveHistory(queryHistory);
      engine = createChatEngine(scrapedData, { initialKnowledge: { topics: [], facts: [], summaries: [], feedback: [] } });
      saveMemory();
      sendJson(response, 200, { ok: true, count: scrapedData.length });
      return;
    }

    if (request.method === "POST" && isRoute(pathname, ["/feedback", "/api/feedback"])) {
      const payload = await readJsonRequest(request);
      engine.knowledgeBase.addFeedback(payload);
      engine.cache.clear();
      saveMemory();
      sendJson(response, 200, { ok: true, facts: engine.knowledgeBase.facts.length });
      return;
    }

    if (request.method === "POST" && isRoute(pathname, ["/ask", "/api/chat"])) {
      const payload = await readJsonRequest(request);
      const query = String(payload.query || "").trim();
      if (!query) {
        sendJson(response, 400, { error: "Query is required." });
        return;
      }
      const answer = engine.ask(query, payload.user_profile || {});
      queryHistory.push({
        query,
        answer: answer.answer,
        confidence: answer.confidence,
        citations: answer.sources,
        createdAt: new Date().toISOString()
      });
      saveHistory(queryHistory);
      saveMemory();
      sendJson(response, 200, answer);
      return;
    }

    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    const statusCode = error.statusCode || (error.message === "Request body too large." ? 413 : 500);
    sendJson(response, statusCode, { error: error.message });
  }
});

const preferredPort = Number(process.env.PORT || 3000);
const maxPortAttempts = 20;

function canUsePort(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port);
  });
}

async function findPort(startPort) {
  const attempts = process.env.PORT ? 1 : maxPortAttempts + 1;
  for (let index = 0; index < attempts; index += 1) {
    const port = startPort + index;
    if (await canUsePort(port)) return port;
  }
  return 0;
}

const port = await findPort(preferredPort);
if (!port) {
  console.error(`No open port found from ${preferredPort} to ${preferredPort + maxPortAttempts}.`);
  process.exit(1);
}

server.listen(port, () => {
  console.log(`Local chatbot running at http://localhost:${port}`);
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
