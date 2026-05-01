import assert from "node:assert/strict";
import { cleanScrapedData, createChatEngine, scrapeHtml } from "../src/index.js";

const testData = [
  {
    title: "Local Engine Facts",
    content:
      "A local knowledge engine answers only from stored local data. It can clean scraped pages, index useful facts, and reuse approved answers. Advertisement: buy traffic today.",
    source: "test/local-engine"
  },
  {
    title: "Scraped Data Cleaning",
    content:
      "Data cleaning removes ads, repeated boilerplate, duplicated sentences, and unrelated paragraphs. Meaningful sentences contain facts, definitions, comparisons, dates, entities, or explanations.",
    source: "test/data-cleaning"
  },
  {
    title: "Offline Architecture",
    content:
      "Offline chatbots should avoid external APIs when privacy, cost control, or disconnected use matters. A modular Node.js system can combine scraping, indexing, memory, and source-backed answers.",
    source: "test/offline-architecture"
  },
  {
    title: "Local URL Scraping",
    content:
      "A production local scraper should fetch HTML directly, remove scripts and styles, extract readable main content, keep the page title, and store the source URL.",
    source: "test/local-url-scraping"
  }
];

const cleaned = cleanScrapedData(testData);
assert.equal(cleaned.length, 4);
assert.ok(!cleaned[0].content.toLowerCase().includes("advertisement: buy traffic today"));

const engine = createChatEngine(testData);
const first = engine.ask("How does the system clean scraped data?", { level: "advanced" });

assert.ok(first["Direct Answer"].length > 0);
assert.ok(first.answer.length > 0);
assert.equal(typeof first.confidence, "number");
assert.ok(first.metadata.matchedSources.length > 0);
assert.ok(engine.knowledgeBase.facts.length > 0);

const second = engine.ask("How does the system clean scraped data?", { level: "advanced" });
assert.equal(second.cached, true);

for (const phrase of ["hi", "hello", "hola", "namaste"]) {
  const reply = engine.ask(phrase, { level: "beginner" });
  assert.equal(reply.metadata.intent, "conversation");
  assert.equal(reply.sources.length, 0);
  assert.ok(reply.answer.toLowerCase().startsWith("hi"));
}

const thanks = engine.ask("thankyou", { level: "beginner" });
assert.equal(thanks.answer, "You’re welcome.");

const bye = engine.ask("bye", { level: "beginner" });
assert.ok(bye.answer.startsWith("Bye"));

const scraped = scrapeHtml(
  "<html><head><title>Scrape Test</title><style>.x{}</style></head><body><nav>Home Login</nav><main><h1>Useful Page</h1><p>Local scraping extracts readable page text without external APIs.</p><p>It removes script and style content before storing knowledge.</p></main><script>alert(1)</script></body></html>",
  "local-test"
);

assert.equal(scraped.title, "Scrape Test");
assert.equal(scraped.source, "local-test");
assert.ok(scraped.content.includes("Local scraping extracts readable page text"));
assert.ok(!scraped.content.includes("alert"));

console.log("Smoke tests passed.");
