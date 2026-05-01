import assert from "node:assert/strict";
import sampleData from "../data/sample-scraped-data.json" with { type: "json" };
import { cleanScrapedData, createChatEngine, scrapeHtml } from "../src/index.js";

const cleaned = cleanScrapedData(sampleData);
assert.equal(cleaned.length, 4);
assert.ok(!cleaned[0].content.toLowerCase().includes("advertisement: buy traffic today"));

const engine = createChatEngine(sampleData);
const first = engine.ask("How does the system clean scraped data?", { level: "advanced" });

assert.ok(first["Direct Answer"].length > 0);
assert.ok(first.metadata.matchedSources.length > 0);
assert.ok(engine.knowledgeBase.facts.length > 0);

const second = engine.ask("How does the system clean scraped data?", { level: "advanced" });
assert.equal(second.cached, true);

const scraped = scrapeHtml(
  "<html><head><title>Scrape Test</title><style>.x{}</style></head><body><nav>Home Login</nav><main><h1>Useful Page</h1><p>Local scraping extracts readable page text without external APIs.</p><p>It removes script and style content before storing knowledge.</p></main><script>alert(1)</script></body></html>",
  "local-test"
);

assert.equal(scraped.title, "Scrape Test");
assert.equal(scraped.source, "local-test");
assert.ok(scraped.content.includes("Local scraping extracts readable page text"));
assert.ok(!scraped.content.includes("alert"));

console.log("Smoke tests passed.");
