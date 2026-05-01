import { v4 as uuid } from "uuid";
import { BM25Index } from "./bm25.js";
import { splitChunks, splitSentences, tokenize } from "./tokenizer.js";
import { hashText } from "../utils/hash.js";
import { detectConversationIntent } from "./intentEngine.js";

const NO_DATA_ANSWER = "No sufficient local data found";

function isFactLike(sentence) {
  return /\b(is|are|means|contains|requires|should|can|may|because|when|if|has|have|provides|stores|uses|supports)\b/i.test(sentence) ||
    /\d/.test(sentence);
}

function contradictionBetween(left, right) {
  const pairs = [
    [/\bshould\b/i, /\bshould not\b|\bavoid\b|\bnever\b/i],
    [/\bcan\b/i, /\bcannot\b|\bcan't\b|\bcan not\b/i],
    [/\bis\b/i, /\bis not\b|\bisn't\b/i],
    [/\brequires\b/i, /\bdoes not require\b|\bwithout\b/i]
  ];
  return pairs.some(([positive, negative]) => {
    return (positive.test(left) && negative.test(right)) || (negative.test(left) && positive.test(right));
  });
}

function compactSources(results) {
  return [...new Map(results.map((result) => [result.source, {
    title: result.title,
    source: result.source,
    score: result.score
  }])).values()].slice(0, 5);
}

export class KnowledgeEngine {
  constructor(db) {
    this.db = db;
    this.index = new BM25Index();
    this.cache = new Map();
    this.cacheLimit = 100;
    this.rebuildIndex();
  }

  rebuildIndex() {
    const chunks = [];

    for (const document of this.db.data.documents) {
      splitChunks(document.content).forEach((text, index) => {
        chunks.push({
          id: `${document.id}:chunk:${index}`,
          documentId: document.id,
          type: document.type || "scraped",
          title: document.title,
          text,
          source: document.source,
          updatedAt: document.lastUpdated || document.timestamp
        });
      });
    }

    for (const fact of this.db.data.facts) {
      chunks.push({
        id: fact.id,
        documentId: fact.documentId,
        type: "fact",
        title: fact.topic || "Fact",
        text: fact.text,
        source: fact.source,
        updatedAt: fact.lastUpdated
      });
    }

    for (const approved of this.db.data.approvedAnswers) {
      chunks.push({
        id: approved.id,
        type: "approved-answer",
        title: approved.query,
        text: approved.answer,
        source: "user-approved-answer",
        updatedAt: approved.lastUpdated
      });
    }

    this.index.build(chunks);
    this.cache.clear();
  }

  async persist() {
    await this.db.write();
  }

  upsertDocument(input) {
    const now = new Date().toISOString();
    const hash = input.hash || hashText(`${input.title}\n${input.content}`);
    const bySource = this.db.data.documents.findIndex((document) => document.source === input.source);
    const byHash = this.db.data.documents.findIndex((document) => document.hash === hash);
    const index = bySource >= 0 ? bySource : byHash;

    const document = {
      id: index >= 0 ? this.db.data.documents[index].id : uuid(),
      title: input.title,
      content: input.content,
      source: input.source,
      hash,
      timestamp: input.timestamp || now,
      lastUpdated: now,
      type: input.type || "scraped"
    };

    if (index >= 0) {
      this.db.data.documents[index] = { ...this.db.data.documents[index], ...document };
    } else {
      this.db.data.documents.push(document);
    }

    this.extractFacts(document);
    return document;
  }

  extractFacts(document) {
    for (const sentence of splitSentences(document.content)) {
      if (!isFactLike(sentence)) continue;
      const hash = hashText(`${document.source}:${sentence}`);
      const existing = this.db.data.facts.findIndex((fact) => fact.hash === hash);
      const fact = {
        id: existing >= 0 ? this.db.data.facts[existing].id : uuid(),
        documentId: document.id,
        text: sentence,
        source: document.source,
        topic: document.title,
        hash,
        lastUpdated: new Date().toISOString(),
        weight: 1
      };
      if (existing >= 0) this.db.data.facts[existing] = { ...this.db.data.facts[existing], ...fact };
      else this.db.data.facts.push(fact);
    }
  }

  async learn({ text, title = "Manual learning", source = "manual" }) {
    const document = this.upsertDocument({
      title,
      content: text,
      source,
      type: "learned"
    });
    await this.persist();
    this.rebuildIndex();
    return document;
  }

  async addScrapedDocuments(documents) {
    const before = this.db.data.documents.length;
    const saved = documents.map((document) => this.upsertDocument(document));
    await this.persist();
    this.rebuildIndex();
    return {
      saved,
      added: this.db.data.documents.length - before,
      total: this.db.data.documents.length
    };
  }

  detectContradictions(results) {
    const contradictions = [];
    for (let leftIndex = 0; leftIndex < results.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < results.length; rightIndex += 1) {
        const left = results[leftIndex];
        const right = results[rightIndex];
        if (left.source === right.source) continue;
        const shared = tokenize(left.text).filter((token) => tokenize(right.text).includes(token));
        if (shared.length >= 3 && contradictionBetween(left.text, right.text)) {
          contradictions.push({
            left: left.text,
            leftSource: left.source,
            right: right.text,
            rightSource: right.source
          });
        }
      }
    }
    return contradictions;
  }

  buildAnswer(query, results) {
    const queryTokens = tokenize(query, { expand: true });
    const candidates = results
      .map((result) => ({
        ...result,
        overlap: result.matchedTokens.length / Math.max(queryTokens.length, 1)
      }))
      .filter((result) => result.overlap >= Math.min(0.5, 2 / Math.max(queryTokens.length, 1)))
      .slice(0, 4);

    if (!candidates.length) return "";

    const approved = candidates.find((result) => result.type === "approved-answer");
    if (approved && approved.overlap >= 0.5) return approved.text;

    return candidates
      .slice(0, 3)
      .map((result) => result.text)
      .join("\n\n");
  }

  confidence(results, contradictions, answer) {
    if (!answer || !results.length) return 0;
    const top = results[0]?.score || 0;
    const second = results[1]?.score || 0;
    const sourceCount = new Set(results.slice(0, 5).map((result) => result.source)).size;
    const raw = top * 0.11 + (top - second) * 0.05 + Math.min(sourceCount, 3) * 0.12 - contradictions.length * 0.2;
    return Number(Math.max(0, Math.min(1, raw)).toFixed(2));
  }

  async ask(query) {
    const cacheKey = query.trim().toLowerCase();
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return { ...cached, cached: true };
    }

    const intentResponse = detectConversationIntent(query);
    if (intentResponse) {
      this.cache.set(cacheKey, intentResponse);
      return intentResponse;
    }

    const results = this.index.search(query, 10);
    const answer = this.buildAnswer(query, results);
    const contradictions = this.detectContradictions(results.slice(0, 6));
    const confidence = this.confidence(results, contradictions, answer);

    const response = answer
      ? {
          answer,
          confidence,
          sources: compactSources(results),
          chunks: results.slice(0, 5).map(({ id, title, text, source, score, type }) => ({ id, title, text, source, score, type })),
          contradictions
        }
      : {
          answer: NO_DATA_ANSWER,
          confidence: 0,
          sources: [],
          chunks: [],
          contradictions: []
        };

    this.db.data.queries.push({
      id: uuid(),
      query,
      answer: response.answer,
      confidence: response.confidence,
      sourceCount: response.sources.length,
      createdAt: new Date().toISOString()
    });
    this.db.data.queries = this.db.data.queries.slice(-500);
    await this.persist();

    this.cache.set(cacheKey, response);
    if (this.cache.size > this.cacheLimit) this.cache.delete(this.cache.keys().next().value);
    return response;
  }

  async addFeedback({ query, answer, rating }) {
    const feedback = {
      id: uuid(),
      query,
      answer,
      rating,
      createdAt: new Date().toISOString()
    };
    this.db.data.feedback.push(feedback);

    if (rating === "good" && answer && answer !== NO_DATA_ANSWER) {
      const hash = hashText(`${query}:${answer}`);
      const existing = this.db.data.approvedAnswers.findIndex((entry) => entry.hash === hash);
      const approved = {
        id: existing >= 0 ? this.db.data.approvedAnswers[existing].id : uuid(),
        query,
        answer,
        hash,
        weight: 2,
        lastUpdated: new Date().toISOString()
      };
      if (existing >= 0) this.db.data.approvedAnswers[existing] = { ...this.db.data.approvedAnswers[existing], ...approved };
      else this.db.data.approvedAnswers.push(approved);
    }

    await this.persist();
    this.rebuildIndex();
    return feedback;
  }
}
