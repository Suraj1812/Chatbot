import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createChatEngine } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const sampleData = JSON.parse(fs.readFileSync(path.join(root, "data/sample-scraped-data.json"), "utf8"));

let scrapedData = sampleData;
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
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload, null, 2));
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(fs.readFileSync(path.join(publicDir, "index.html"), "utf8"));
      return;
    }

    if (request.method === "GET" && request.url === "/api/data") {
      sendJson(response, 200, { scrapedData, knowledgeBase: engine.knowledgeBase.toJSON() });
      return;
    }

    if (request.method === "POST" && request.url === "/api/data") {
      const payload = JSON.parse(await readBody(request));
      if (!Array.isArray(payload.scraped_data)) {
        sendJson(response, 400, { error: "Expected scraped_data to be an array." });
        return;
      }
      scrapedData = payload.scraped_data;
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

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`Local chatbot running at http://localhost:${port}`);
});
