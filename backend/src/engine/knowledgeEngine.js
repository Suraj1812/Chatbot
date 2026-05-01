import { v4 as uuid } from "uuid";
import { BM25Index } from "./bm25.js";
import { splitChunks, splitSentences, tokenize, tokenOverlap, uniqueTokens } from "./tokenizer.js";
import { hashText } from "../utils/hash.js";
import { detectConversationIntent } from "./intentEngine.js";

const NO_DATA_ANSWER = "No sufficient local data found";
const ANSWER_THRESHOLD = 0.42;

const ACTION_TOKENS = new Set([
  "best", "better", "choose", "compare", "create", "define", "difference", "example",
  "explain", "find", "get", "list", "make", "mean", "meaning", "need", "overview",
  "question", "search", "should", "summary", "tell", "want"
]);

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

function questionKind(query) {
  const normalized = query.trim().toLowerCase();
  if (/^(what is|what are|who is|who are|define|tell me about)\b/.test(normalized)) return "definition";
  if (/^(how|how do|how does|how to)\b/.test(normalized)) return "how";
  if (/^(why)\b/.test(normalized)) return "why";
  return "general";
}

function queryCoreTokens(query) {
  const tokens = uniqueTokens(query).filter((token) => !ACTION_TOKENS.has(token));
  return tokens.length ? tokens : uniqueTokens(query);
}

function hostFromSource(source) {
  try {
    return new URL(source).hostname.replace(/^www\./, "");
  } catch {
    return String(source || "");
  }
}

function sourceQuality(result, coreTokens) {
  let score = 0;
  if (result.type === "approved-answer") score += 2;
  if (result.type === "learned" || result.source === "manual") score += 0.6;
  if (/^https:\/\//i.test(result.source || "")) score += 0.2;

  const host = hostFromSource(result.source);
  const hostTokens = uniqueTokens(host.replace(/[.-]/g, " "));
  const titleTokens = result.titleTokens || uniqueTokens(result.title || "");
  score += tokenOverlap(coreTokens, titleTokens) * 0.7;
  score += tokenOverlap(coreTokens, hostTokens) * 0.5;

  if (/\b(blog|news|docs|developer|support|help|learn|guide|wiki|wikipedia)\b/i.test(host)) score += 0.1;
  if (/\b(pinterest|facebook|instagram|x\.com|twitter|reddit)\b/i.test(host)) score -= 0.6;
  return score;
}

function sentenceQuality(text, kind, coreTokens = []) {
  const value = String(text || "").trim();
  let score = 0;
  const words = value.split(/\s+/).filter(Boolean);
  const lower = value.toLowerCase();
  const textTokens = uniqueTokens(value);
  const directOverlap = tokenOverlap(coreTokens, textTokens);

  if (words.length >= 8 && words.length <= 45) score += 0.8;
  if (words.length > 70) score -= 0.5;
  if (words.length < 5) score -= 1;
  if (/\?$/.test(value)) score -= 1.2;
  if (/\b(click|subscribe|sign up|cookie|advertisement|buy now|all rights reserved|privacy policy|terms of use)\b/i.test(value)) score -= 1.2;
  if (/\b(npm|brew|install|download|pricing|plans?|bundled|month|competitors?|advantages?)\b|\$\d/i.test(value)) score -= 0.8;
  if (/^(npm|brew|pip|pnpm|yarn|curl)\b/i.test(value)) score -= 3;
  if (/\binteresting product|biggest advantage|challenged competitors\b/i.test(value)) score -= 1.1;
  if (/\b(api reference|breakdown of the plans|here'?s a breakdown)\b/i.test(value)) score -= 0.6;
  if (/(.)\1{5,}/.test(lower)) score -= 0.8;
  if (coreTokens.length && directOverlap === 0) score -= 1.4;
  if (directOverlap >= 0.5) score += 0.9;

  if (kind === "definition") {
    if (/\b(is|are|refers to|means|is a|is an)\b/i.test(value)) score += 1.2;
    if (/\b(ai|artificial intelligence|agent|assistant|developer|software|system|tool|platform|service|model|application)\b/i.test(value)) score += 0.8;
    if (/^(what|how|why|when|where)\b/i.test(value)) score -= 1;
  }

  if (kind === "how" && /\b(step|use|start|create|install|run|configure|works|process)\b/i.test(value)) score += 0.8;
  if (kind === "why" && /\b(because|reason|due to|caused by|so that)\b/i.test(value)) score += 0.8;
  return score;
}

function normalizeAnswerText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

function dedupeByMeaning(results) {
  const seen = new Set();
  return results.filter((result) => {
    const key = normalizeAnswerText(result.text).toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 160);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
      splitChunks(document.content, 1).forEach((text, index) => {
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

  isAnswerSufficient(answer) {
    return answer?.intent === "conversation" || (answer?.answer !== NO_DATA_ANSWER && answer?.confidence >= ANSWER_THRESHOLD);
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

    this.db.data.facts = this.db.data.facts.filter((fact) => fact.documentId !== document.id);
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
    const queryTokens = uniqueTokens(query, { expand: true });
    const coreTokens = queryCoreTokens(query);
    const kind = questionKind(query);
    const candidates = dedupeByMeaning(results
      .map((result) => ({
        ...result,
        overlap: result.matchedTokens.length / Math.max(queryTokens.length, 1),
        textOverlap: tokenOverlap(coreTokens, result.textTokens || uniqueTokens(result.text)),
        titleOverlap: tokenOverlap(coreTokens, result.titleTokens || uniqueTokens(result.title || "")),
        answerScore: result.score +
          sentenceQuality(result.text, kind, coreTokens) +
          sourceQuality(result, coreTokens)
      }))
      .filter((result) => {
        const minimumOverlap = Math.min(0.5, 2 / Math.max(queryTokens.length, 1));
        const hasQuestionTermInText = result.textOverlap >= Math.min(0.5, 1 / Math.max(coreTokens.length, 1));
        const hasStrongTitleMatch = result.titleOverlap >= 0.7 && sentenceQuality(result.text, kind, coreTokens) > 0.2;
        return result.overlap >= minimumOverlap && (hasQuestionTermInText || hasStrongTitleMatch);
      })
      .filter((result) => sentenceQuality(result.text, kind, coreTokens) > -0.35)
      .sort((left, right) => right.answerScore - left.answerScore))
      .slice(0, 5);

    if (!candidates.length) return "";

    const approved = candidates.find((result) => result.type === "approved-answer");
    if (approved && approved.overlap >= 0.5) return approved.text;

    return candidates
      .slice(0, kind === "definition" ? 2 : 4)
      .map((result) => normalizeAnswerText(result.text))
      .join("\n\n");
  }

  confidence(results, contradictions, answer) {
    if (!answer || !results.length) return 0;
    const top = results[0]?.score || 0;
    const second = results[1]?.score || 0;
    const sourceCount = new Set(results.slice(0, 5).map((result) => result.source)).size;
    const supported = results.slice(0, 5).filter((result) => answer.includes(result.text.slice(0, Math.min(80, result.text.length)))).length;
    const raw = Math.min(top / 9, 0.48) +
      Math.min(Math.max(top - second, 0) / 10, 0.12) +
      Math.min(sourceCount, 4) * 0.08 +
      Math.min(supported, 3) * 0.06 -
      contradictions.length * 0.18;
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
