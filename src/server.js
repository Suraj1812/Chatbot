import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createChatEngine } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const dataDir = path.join(root, "data");
const sampleDataPath = path.join(dataDir, "sample-scraped-data.json");
const localDataPath = path.join(dataDir, "local-scraped-data.json");
const sampleData = JSON.parse(fs.readFileSync(sampleDataPath, "utf8"));

function loadLocalData() {
  if (!fs.existsSync(localDataPath)) return sampleData;
  const parsed = JSON.parse(fs.readFileSync(localDataPath, "utf8"));
  return Array.isArray(parsed) ? parsed : sampleData;
}

function saveLocalData(data) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(localDataPath, `${JSON.stringify(data, null, 2)}\n`);
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
let engine = createChatEngine(scrapedData);

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Request body too large."));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(fs.readFileSync(path.join(publicDir, "index.html"), "utf8"));
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, {
        ok: true,
        sources: scrapedData.length,
        facts: engine.knowledgeBase.facts.length
      });
      return;
    }

    if (request.method === "GET" && request.url === "/api/data") {
      sendJson(response, 200, { scrapedData, knowledgeBase: engine.knowledgeBase.toJSON() });
      return;
    }

    if (request.method === "POST" && request.url === "/api/data") {
      const payload = JSON.parse(await readBody(request));
      const validationError = validateScrapedData(payload.scraped_data);
      if (validationError) {
        sendJson(response, 400, { error: validationError });
        return;
      }
      scrapedData = payload.scraped_data;
      saveLocalData(scrapedData);
      engine = createChatEngine(scrapedData);
      sendJson(response, 200, { ok: true, count: scrapedData.length });
      return;
    }

    if (request.method === "POST" && request.url === "/api/reset") {
      scrapedData = sampleData;
      saveLocalData(scrapedData);
      engine = createChatEngine(scrapedData);
      sendJson(response, 200, { ok: true, count: scrapedData.length });
      return;
    }

    if (request.method === "POST" && request.url === "/api/chat") {
      const payload = JSON.parse(await readBody(request));
      const query = String(payload.query || "").trim();
      if (!query) {
        sendJson(response, 400, { error: "Query is required." });
        return;
      }
      sendJson(response, 200, engine.ask(query, payload.user_profile || {}));
      return;
    }

    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

const preferredPort = Number(process.env.PORT || 3000);
const maxPortAttempts = 20;

function listen(port, attemptsLeft = maxPortAttempts) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0 && !process.env.PORT) {
      listen(port + 1, attemptsLeft - 1);
      return;
    }

    if (error.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Stop the other app or run with PORT=${port + 1} npm start.`);
      process.exit(1);
    }

    console.error(error.message);
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`Local chatbot running at http://localhost:${port}`);
  });
}

listen(preferredPort);

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
