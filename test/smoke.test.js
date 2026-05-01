import assert from "node:assert/strict";
import sampleData from "../data/sample-scraped-data.json" with { type: "json" };
import { cleanScrapedData, createChatEngine } from "../src/index.js";

const cleaned = cleanScrapedData(sampleData);
assert.equal(cleaned.length, 3);
assert.ok(!cleaned[0].content.toLowerCase().includes("advertisement: buy traffic today"));

const engine = createChatEngine(sampleData);
const first = engine.ask("How does the system clean scraped data?", { level: "advanced" });

assert.ok(first["Direct Answer"].length > 0);
assert.ok(first.metadata.matchedSources.length > 0);
assert.ok(engine.knowledgeBase.facts.length > 0);

const second = engine.ask("How does the system clean scraped data?", { level: "advanced" });
assert.equal(second.cached, true);

console.log("Smoke tests passed.");
