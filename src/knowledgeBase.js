import { normalizeText, tokenize } from "./tokenizer.js";

function upsertUnique(collection, value, keySelector = (item) => normalizeText(item)) {
  const key = keySelector(value);
  if (!key) return false;
  const index = collection.findIndex((item) => keySelector(item) === key);
  if (index >= 0) {
    if (typeof value === "object" && value !== null && typeof collection[index] === "object" && collection[index] !== null) {
      collection[index] = { ...collection[index], ...value, updatedAt: new Date().toISOString() };
    }
    return false;
  }
  collection.push(value);
  return true;
}

export class KnowledgeBase {
  constructor(initial = {}) {
    this.topics = initial.topics || [];
    this.facts = initial.facts || [];
    this.summaries = initial.summaries || [];
    this.feedback = initial.feedback || [];
  }

  learnFromResults(results = []) {
    for (const result of results) {
      const { item } = result;
      upsertUnique(this.topics, item.title);

      for (const sentence of item.sentences || []) {
        if (this.looksLikeFact(sentence)) {
          upsertUnique(this.facts, {
            text: sentence,
            source: item.source,
            topic: item.title,
            learnedAt: new Date().toISOString()
          }, (fact) => normalizeText(fact.text));
        }
      }

      const summary = this.summarizeItem(item);
      if (summary) {
        upsertUnique(this.summaries, {
          topic: item.title,
          source: item.source,
          summary,
          learnedAt: new Date().toISOString()
        }, (entry) => `${normalizeText(entry.topic)}:${normalizeText(entry.summary)}`);
      }
    }
  }

  learnFromText(text, source = "local-note", topic = "Local Note") {
    const sentences = String(text || "")
      .split(/(?<=[.!?])\s+|\n+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    const item = {
      title: topic,
      source,
      sentences
    };

    this.learnFromResults([{ item, score: 1 }]);
  }

  addFeedback(entry = {}) {
    this.feedback.push({
      query: String(entry.query || ""),
      answer: String(entry.answer || ""),
      rating: entry.rating === "down" ? "down" : "up",
      note: String(entry.note || ""),
      createdAt: new Date().toISOString()
    });

    if (entry.rating === "up" && entry.answer) {
      upsertUnique(this.facts, {
        text: entry.answer,
        source: "user-approved-answer",
        topic: entry.query || "Approved Answer",
        learnedAt: new Date().toISOString()
      }, (fact) => normalizeText(fact.text));
    }
  }

  looksLikeFact(sentence) {
    return /\b(is|are|means|contains|removes|should|can|may|because|when|if|choose|combine|avoid)\b/i.test(sentence);
  }

  summarizeItem(item) {
    const sentences = item.sentences || [];
    if (sentences.length === 0) return "";
    return sentences.slice(0, 2).join(" ");
  }

  findRelevantFacts(query, limit = 5) {
    const queryTerms = new Set(tokenize(query));
    return this.facts
      .map((fact) => {
        const factTerms = new Set(tokenize(fact.text));
        let overlap = 0;
        for (const term of queryTerms) {
          if (factTerms.has(term)) overlap += 1;
        }
        const approvedBoost = fact.source === "user-approved-answer" ? 2 : 0;
        return { ...fact, overlap, score: overlap + approvedBoost };
      })
      .filter((fact) => fact.score > 0)
      .sort((left, right) => right.overlap - left.overlap || right.score - left.score)
      .slice(0, limit);
  }

  toJSON() {
    return {
      topics: this.topics,
      facts: this.facts,
      summaries: this.summaries,
      feedback: this.feedback
    };
  }
}
