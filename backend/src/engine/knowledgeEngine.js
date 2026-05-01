import { v4 as uuid } from "uuid";
import { BM25Index } from "./bm25.js";
import { normalizeText, splitChunks, splitSentences, tokenize, tokenOverlap, uniqueTokens } from "./tokenizer.js";
import { hashText } from "../utils/hash.js";
import { detectConversationIntent } from "./intentEngine.js";

const NO_DATA_ANSWER = "No sufficient local data found";
const ANSWER_THRESHOLD = 0.42;

const ACTION_TOKENS = new Set([
  "best", "better", "choose", "compare", "create", "define", "difference", "example",
  "explain", "find", "get", "list", "make", "mean", "meaning", "need", "overview",
  "question", "search", "should", "summary", "tell", "want"
]);

const BROAD_TOKENS = new Set([
  "answer", "content", "data", "document", "engine", "fact", "guide", "knowledge",
  "local", "memory", "note", "page", "result", "search", "source", "store", "stored",
  "system", "thing", "tool", "use", "user"
]);

const HONORIFIC_TOKENS = new Set(["maa", "ma", "mata", "shri", "sri", "lord"]);
const SUBJECT_MODIFIER_TOKENS = new Set([
  "article", "biography", "course", "engine", "family", "father", "guide", "history",
  "mother", "page", "profile", "son", "story", "tutorial", "wife", "library",
  "database", "framework", "language", "runtime", "ranking", "rank", "search",
  "state", "management", "html", "parser", "parsing"
]);
const HOW_ACTION_TOKENS = new Set([
  "apply", "become", "brew", "build", "complete", "cook", "create", "earn", "follow",
  "grind", "heat", "learn", "made", "make", "mix", "prepare", "practice", "start", "study",
  "train", "use", "write"
]);
const HOW_PROCESS_PATTERNS = /\b(apply|become|brew|build|complete|cook|create|earn|follow|grind|heat|learn|made|make|method|mix|prepare|practice|process|steps?|start|study|train|use|write)\b/i;
const DEFINITION_PATTERNS = /\b(is|are|was|were|refers to|means|known as|known for|called|serves as|leader|politician|goddess|god|deity|river|city|district|state|person|founder|actor|singer|writer|minister|president|prime minister)\b/i;
const OVERVIEW_BAD_PATTERNS = /\b(address|administration|biopic|book|controversy|drama|episode|explore|faq|film|movie|mother|father|wife|husband|son|daughter|family|near|opinion polling|parking|places to visit|poems?|question|relationship|religious places|temples?|mandir|gurudwara|visit near|best time to visit|answer)\b/i;
const OVERVIEW_GOOD_PATTERNS = /\b(is|are|city|district|state|located|known for|famous for|population|part of|region|area|capital|founded|established)\b/i;

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
  if (/^(capital of|population of|currency of|president of|prime minister of)\b/.test(normalized)) return "fact";
  if (uniqueTokens(normalized).length <= 2) return "overview";
  return "general";
}

function queryCoreTokens(query) {
  const tokens = uniqueTokens(query).filter((token) => !ACTION_TOKENS.has(token));
  return tokens.length ? tokens : uniqueTokens(query);
}

function queryProfile(query) {
  const kind = questionKind(query);
  const coreTokens = queryCoreTokens(query);
  const specificTokens = coreTokens.filter((token) => !BROAD_TOKENS.has(token) && !HONORIFIC_TOKENS.has(token));
  const normalized = query.trim().toLowerCase();
  const isIdentityQuestion = /^(who is|who are|what is|what are|define|tell me about)\b/.test(normalized);
  const entityStrict = specificTokens.length >= 1 && (
    isIdentityQuestion ||
    kind === "overview"
  );
  return { kind, coreTokens, specificTokens, entityStrict };
}

function firstTokenPosition(tokens, textTokens) {
  const positions = tokens
    .map((token) => textTokens.indexOf(token))
    .filter((index) => index >= 0);
  return positions.length ? Math.min(...positions) : Infinity;
}

function entityAppearsEarly(result, specificTokens) {
  if (!specificTokens.length) return true;
  const textTokens = result.textTokens || uniqueTokens(result.text);
  const allInText = specificTokens.every((token) => textTokens.includes(token));
  return allInText && firstTokenPosition(specificTokens, textTokens) <= 2;
}

function directIdentityFocus(result, specificTokens) {
  if (!specificTokens.length) return true;
  const textTokens = result.textTokens || uniqueTokens(result.text);
  if (!specificTokens.every((token) => textTokens.includes(token))) return false;
  const focusTokens = specificTokens.filter((token) => !SUBJECT_MODIFIER_TOKENS.has(token));
  const requiredFocusTokens = focusTokens.length ? focusTokens : specificTokens.slice(0, 2);
  const positionTokens = tokenize(result.text);
  const positions = requiredFocusTokens.map((token) => positionTokens.findIndex((candidate) => candidate === token));
  if (positions.some((position) => position < 0)) return false;

  if (requiredFocusTokens.length === 1) {
    const position = positions[0];
    const nextToken = textTokens[textTokens.indexOf(requiredFocusTokens[0]) + 1];
    return position <= 1 && !SUBJECT_MODIFIER_TOKENS.has(nextToken);
  }

  const first = Math.min(...positions);
  const last = Math.max(...positions);
  return first <= 1 && last <= 8 && (DEFINITION_PATTERNS.test(result.text) || OVERVIEW_GOOD_PATTERNS.test(result.text));
}

function requiredSpecificCoverage(kind, specificTokens, entityStrict) {
  if (!specificTokens.length) return 0;
  if (entityStrict || kind === "definition" || kind === "overview") return 1;
  if (kind === "how") return specificTokens.length <= 2 ? 1 : 0.66;
  return specificTokens.length <= 2 ? 1 : 0.6;
}

function hasHowToProof(result, specificTokens) {
  const textTokens = result.textTokens || uniqueTokens(result.text);
  const topicTokens = specificTokens.filter((token) => !HOW_ACTION_TOKENS.has(token));
  const hasTopic = topicTokens.length
    ? tokenOverlap(topicTokens, textTokens) >= Math.min(1, 1 / Math.max(topicTokens.length, 1))
    : tokenOverlap(specificTokens, textTokens) > 0;
  return hasTopic && HOW_PROCESS_PATTERNS.test(result.text);
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

function leadPositionBoost(result, kind) {
  const position = Number.isFinite(result.position) ? result.position : 999;
  if (position > 30) return 0;
  const base = kind === "definition" || kind === "fact" || kind === "overview" ? 2.4 : 0.8;
  return Math.max(0, base - position * 0.14);
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
  if (/^\[?\d+]|^["'“”]/.test(value)) score -= 4;
  if (/^\[[a-z]\]/i.test(value)) score -= 4;
  if (/^\([^)]{1,120}\)/.test(value)) score -= 2;
  if (/^(also|and|but|or|it|this|that|these|those|he|she|they|his|her|their)\b/i.test(value)) score -= 3;
  if ((value.match(/\b\d+(?:\.\d+)?\s+[A-Z]/g) || []).length >= 2) score -= 6;
  if (/\?$/.test(value)) score -= 5;
  if (/\b(click|subscribe|sign up|cookie|advertisement|buy now|all rights reserved|privacy policy|terms of use)\b/i.test(value)) score -= 1.2;
  if (/\b(npm|brew|install|download|pricing|plans?|bundled|month|competitors?|advantages?)\b|\$\d/i.test(value)) score -= 0.8;
  if (/^(npm|brew|pip|pnpm|yarn|curl)\b/i.test(value)) score -= 3;
  if (/\binteresting product|biggest advantage|challenged competitors\b/i.test(value)) score -= 1.1;
  if (/\b(api reference|breakdown of the plans|here'?s a breakdown)\b/i.test(value)) score -= 0.6;
  if (/(.)\1{5,}/.test(lower)) score -= 0.8;
  if (coreTokens.length && directOverlap === 0) score -= 1.4;
  if (directOverlap >= 0.5) score += 0.9;

  if (kind === "definition") {
    if (DEFINITION_PATTERNS.test(value)) score += 1.2;
    if (/\b(ai|artificial intelligence|agent|assistant|developer|software|system|tool|platform|service|model|application)\b/i.test(value)) score += 0.8;
    if (/\b(is|are)\s+(a|an|the)\b/i.test(value)) score += 0.8;
    if (/^in\b/i.test(value)) score -= 1.5;
    if (/\b(was|were)\s+born\b/i.test(value)) score -= 1.5;
    if (/\b(mother|father|wife|husband|son|daughter|grandson|granddaughter|family)\b/i.test(value)) score -= 2;
    if (/^(what|how|why|when|where)\b/i.test(value)) score -= 1;
    if (words.length > 65) score -= 2.5;
  }

  if (kind === "overview") {
    if (OVERVIEW_GOOD_PATTERNS.test(value)) score += 0.9;
    if (OVERVIEW_BAD_PATTERNS.test(value)) score -= 1.8;
    if (!OVERVIEW_GOOD_PATTERNS.test(value)) score -= 0.8;
  }

  if (kind === "how") {
    if (/\b(step|use|start|create|install|run|configure|works|process|complete|training|degree|apply)\b/i.test(value)) score += 0.8;
    if (words.length < 8) score -= 1.5;
    if (/:$/.test(value)) score -= 1.2;
    if (/^how to\b/i.test(value)) score -= 2;
    if (/^(can|what|how|are|is)\b/i.test(value) && words.length < 10) score -= 2;
    if (/\b(article will provide|comprehensive guide|help you get started|explore how|outline the steps)\b|^starting a career\b/i.test(value)) score -= 1.5;
  }
  if (kind === "why" && /\b(because|reason|due to|caused by|so that)\b/i.test(value)) score += 0.8;
  if (kind === "fact" && /\b(is|are|was|were|capital|population|currency|president|prime minister)\b/i.test(value)) score += 0.8;
  return score;
}

function normalizeAnswerText(text) {
  return String(text || "")
    .replace(/\[[a-z0-9]+]/gi, "")
    .replace(/^\([^)]{1,120}\)\s*/, "")
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

function buildCandidateResponse(query, results) {
  const queryTokens = uniqueTokens(query, { expand: true });
  const { kind, coreTokens, specificTokens, entityStrict } = queryProfile(query);
  const scored = dedupeByMeaning(results
    .map((result) => ({
      ...result,
      overlap: result.matchedTokens.length / Math.max(queryTokens.length, 1),
      textOverlap: tokenOverlap(coreTokens, result.textTokens || uniqueTokens(result.text)),
      titleOverlap: tokenOverlap(coreTokens, result.titleTokens || uniqueTokens(result.title || "")),
      specificTextOverlap: tokenOverlap(specificTokens, result.textTokens || uniqueTokens(result.text)),
      specificTitleOverlap: tokenOverlap(specificTokens, result.titleTokens || uniqueTokens(result.title || "")),
      quality: sentenceQuality(result.text, kind, coreTokens),
      answerScore: result.score +
        sentenceQuality(result.text, kind, coreTokens) +
        sourceQuality(result, coreTokens) +
        leadPositionBoost(result, kind) +
        tokenOverlap(specificTokens, result.textTokens || uniqueTokens(result.text)) * 1.5
    }))
    .filter((result) => {
      const minimumOverlap = Math.min(0.5, 2 / Math.max(queryTokens.length, 1));
      const hasQuestionTermInText = result.textOverlap >= Math.min(0.5, 1 / Math.max(coreTokens.length, 1));
      const hasStrongTitleMatch = result.titleOverlap >= 0.7 && result.quality > 0.2;
      const requiredCoverage = requiredSpecificCoverage(kind, specificTokens, entityStrict);
      const hasSpecificTerm = !specificTokens.length || result.specificTextOverlap >= requiredCoverage;
      const hasEntityFocus = !entityStrict || entityAppearsEarly(result, specificTokens);
      const needsDefinitionShape = kind === "definition" || (kind === "overview" && entityStrict);
      const hasDefinitionShape = !needsDefinitionShape || DEFINITION_PATTERNS.test(result.text) || OVERVIEW_GOOD_PATTERNS.test(result.text);
      const hasDirectSubjectFocus = (kind !== "definition" && kind !== "overview") || !entityStrict || directIdentityFocus(result, specificTokens);
      const hasHowShape = kind !== "how" || hasHowToProof(result, specificTokens);
      const hasOverviewShape = kind !== "overview" || !OVERVIEW_BAD_PATTERNS.test(result.text);
      const qualityFloor = kind === "overview" ? 0.35 : kind === "how" ? 0.45 : -0.2;
      return result.overlap >= minimumOverlap &&
        hasSpecificTerm &&
        hasEntityFocus &&
        hasDefinitionShape &&
        hasDirectSubjectFocus &&
        hasHowShape &&
        hasOverviewShape &&
        result.quality > qualityFloor &&
        (hasQuestionTermInText || hasStrongTitleMatch);
    })
    .sort((left, right) => right.answerScore - left.answerScore))
    .slice(0, 5);

  const approved = scored.find((result) => result.type === "approved-answer");
  const candidateLimit = kind === "definition" ? 1 : kind === "fact" || kind === "how" ? 2 : 4;
  const candidates = approved && approved.overlap >= 0.5 ? [approved] : scored.slice(0, candidateLimit);
  const answer = candidates.map((result) => normalizeAnswerText(result.text)).join("\n\n");
  return { answer, candidates };
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
          position: index,
          updatedAt: document.lastUpdated || document.timestamp
        });
      });
    }

    const factPositions = new Map();
    for (const fact of this.db.data.facts) {
      const inferredPosition = factPositions.get(fact.documentId) || 0;
      factPositions.set(fact.documentId, inferredPosition + 1);
      chunks.push({
        id: fact.id,
        documentId: fact.documentId,
        type: "fact",
        title: fact.topic || "Fact",
        text: fact.text,
        source: fact.source,
        position: Number.isFinite(fact.position) ? fact.position : inferredPosition,
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

  canAutoResearch(query) {
    return !/\b(who am i|who is me|who i am|my name|about me|do you know me)\b/i.test(query);
  }

  upsertDocument(input) {
    const now = new Date().toISOString();
    const hash = input.hash || hashText(`${input.title}\n${input.content}`);
    const shouldDedupeBySource = input.source && !String(input.source).startsWith("manual");
    const bySource = shouldDedupeBySource
      ? this.db.data.documents.findIndex((document) => document.source === input.source)
      : -1;
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
    const sentences = splitSentences(document.content);
    for (const [position, sentence] of sentences.entries()) {
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
        position,
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
      source: source === "manual" ? `manual:${hashText(`${title}\n${text}`).slice(0, 16)}` : source,
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
    return buildCandidateResponse(query, results).answer;
  }

  confidence(results, contradictions, answer) {
    if (!answer || !results.length) return 0;
    const top = results[0]?.score || 0;
    const second = results[1]?.score || 0;
    const sourceCount = new Set(results.slice(0, 5).map((result) => result.source)).size;
    const normalizedAnswer = normalizeAnswerText(answer);
    const supported = results.slice(0, 5).filter((result) => normalizedAnswer.includes(normalizeAnswerText(result.text).slice(0, 80))).length;
    const raw = Math.min(top / 9, 0.48) +
      Math.min(Math.max(top - second, 0) / 10, 0.12) +
      Math.min(sourceCount, 4) * 0.08 +
      Math.min(supported, 3) * 0.06 -
      contradictions.length * 0.18 +
      (supported > 0 ? 0.08 : 0);
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

    const results = this.index.search(query, 250);
    const { answer, candidates } = buildCandidateResponse(query, results);
    const contradictions = this.detectContradictions(candidates.slice(0, 6));
    const confidence = this.confidence(candidates, contradictions, answer);
    const sourceResults = candidates;

    const response = answer && confidence >= 0.35
      ? {
          answer,
          confidence,
          sources: compactSources(sourceResults),
          chunks: sourceResults.slice(0, 5).map(({ id, title, text, source, score, type }) => ({ id, title, text, source, score, type })),
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
    } else if (rating === "bad") {
      this.db.data.approvedAnswers = this.db.data.approvedAnswers.filter((entry) => {
        return entry.hash !== hashText(`${query}:${answer}`) && entry.answer !== answer;
      });
    }

    await this.persist();
    this.rebuildIndex();
    return feedback;
  }
}
