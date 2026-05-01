import assert from "node:assert/strict";
import fs from "node:fs";
import { createDb } from "../backend/src/utils/db.js";
import { KnowledgeEngine } from "../backend/src/engine/knowledgeEngine.js";

process.env.DB_PATH = `/private/tmp/local-knowledge-engine-regression-${process.pid}.json`;

const db = await createDb();
db.data = {
  documents: [],
  facts: [],
  approvedAnswers: [],
  feedback: [],
  queries: []
};
await db.write();

const engine = new KnowledgeEngine(db);

await engine.addScrapedDocuments([
  {
    title: "Temple guide",
    content: "Mahatma Gandhi inaugurated the temple with a condition that it be open to all castes. About: Dedicated to Goddess Kalka, a form of Maa Durga.",
    source: "test/noisy-temple",
    type: "scraped"
  },
  {
    title: "PM profile",
    content: "Substantive measures been taken for a clean Ganga. On 2nd October 2014, Mahatma Gandhi’s Birth Anniversary, the PM launched Swachh Bharat Mission.",
    source: "test/noisy-pm",
    type: "scraped"
  },
  {
    title: "Narendra Modi",
    content: "His victory margin was the second lowest ever for a sitting prime minister. In the 2025 Indian electoral controversy, Rahul Gandhi, leader of the opposition in Lok Sabha, claimed widespread electoral fraud.",
    source: "test/noisy-modi",
    type: "scraped"
  },
  {
    title: "Faridabad temples",
    content: "Address: Parson mandir, near Badkhal Lake, Faridabad. Is there parking available near temples in Faridabad?",
    source: "test/noisy-faridabad",
    type: "scraped"
  }
]);

for (const query of ["who is rahul gandhi", "rahul gandhi", "who is maa ganga", "faridabad", "who is me?"]) {
  const answer = await engine.ask(query);
  assert.equal(answer.answer, "No sufficient local data found", query);
  assert.equal(answer.confidence, 0, query);
}

assert.equal(engine.canAutoResearch("who is me?"), false);

await engine.learn({
  title: "Rahul Gandhi",
  source: "manual",
  text: "Rahul Gandhi is an Indian politician and a member of the Indian National Congress. He has served as Leader of the Opposition in the Lok Sabha."
});
await engine.learn({
  title: "Maa Ganga",
  source: "manual",
  text: "Maa Ganga is the Hindu goddess associated with the sacred river Ganges. She is revered as a purifier and motherly divine figure in Hindu tradition."
});
await engine.learn({
  title: "Faridabad",
  source: "manual",
  text: "Faridabad is a city in the Indian state of Haryana and part of the National Capital Region. It is known as an industrial hub near Delhi."
});

const rahul = await engine.ask("who is rahul gandhi");
assert.match(rahul.answer, /Rahul Gandhi is an Indian politician/i);
assert.ok(rahul.confidence > 0.4);

const ganga = await engine.ask("who is maa ganga");
assert.match(ganga.answer, /Maa Ganga is the Hindu goddess/i);
assert.ok(ganga.confidence > 0.4);

const faridabad = await engine.ask("faridabad");
assert.match(faridabad.answer, /Faridabad is a city/i);
assert.ok(faridabad.confidence > 0.4);

fs.rmSync(process.env.DB_PATH, { force: true });
console.log("Engine regression tests passed.");
