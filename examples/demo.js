import sampleData from "../data/sample-scraped-data.json" with { type: "json" };
import { createChatEngine } from "../src/index.js";

const engine = createChatEngine(sampleData);

const response = engine.ask("What should I choose for a beginner offline chatbot?", {
  level: "beginner",
  goal: "Build a local chatbot"
});

console.log(JSON.stringify(response, null, 2));
