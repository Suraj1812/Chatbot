import { cleanScrapedData } from "./cleaner.js";
import { KnowledgeBase } from "./knowledgeBase.js";
import { analyzeSources } from "./multiSourceAnalyzer.js";
import { normalizeUserProfile, adjustForLevel, formatAdvice } from "./personalization.js";
import { RelevanceEngine } from "./relevanceEngine.js";
import { tokenize } from "./tokenizer.js";
import { detectConversationIntent } from "./intentEngine.js";

function buildDirectAnswer(query, analysis, relevantFacts) {
  if (relevantFacts.length > 0) {
    const bestScore = relevantFacts[0].score || 0;
    const minimumOverlap = Math.min(2, Math.max(tokenize(query).length - 1, 1));
    const focusedFacts = relevantFacts
      .filter((fact) => fact.score >= Math.max(1, bestScore * 0.58))
      .filter((fact) => (fact.overlap || 0) >= minimumOverlap)
      .slice(0, 2);

    if (!focusedFacts.length) return "No sufficient local data found";
    return focusedFacts
      .map((fact) => fact.text)
      .join(" ");
  }

  if (analysis.consensus.length > 0) {
    return analysis.consensus
      .slice(0, 2)
      .map((item) => item.text)
      .join(" ");
  }

  return "No sufficient local data found";
}

function citationSources(facts) {
  return [...new Set(facts.map((fact) => fact.source).filter(Boolean))].slice(0, 4);
}

function factsFromRankedSentences(query, results) {
  const queryTerms = new Set(tokenize(query));
  return results
    .flatMap((result) => {
      return (result.item.sentences || []).map((sentence) => {
        const sentenceTerms = new Set(tokenize(sentence));
        let overlap = 0;
        for (const term of queryTerms) {
          if (sentenceTerms.has(term)) overlap += 1;
        }
        const density = overlap / Math.max(sentenceTerms.size, 1);
        return {
          text: sentence,
          source: result.item.source,
          topic: result.item.title,
          overlap,
          score: overlap * 10 + density * 8 + result.score
        };
      });
    })
    .filter((fact) => fact.score > 0)
    .sort((left, right) => right.overlap - left.overlap || right.score - left.score);
}

function confidenceFrom(results, analysis, relevantFacts) {
  if (results.length === 0 && relevantFacts.length === 0) return 0;
  const top = results[0]?.score || relevantFacts[0]?.score || 0;
  const second = results[1]?.score || 0;
  const spread = top - second;
  const sourceBonus = Math.min(analysis.sourceCount, 3) * 0.15;
  const conflictPenalty = analysis.contradictions.length ? 0.5 : 0;
  const factBonus = Math.min(relevantFacts.length, 3) * 0.08;
  const raw = top * 0.11 + spread * 0.06 + sourceBonus + factBonus - conflictPenalty;
  return Number(Math.max(0, Math.min(1, raw)).toFixed(2));
}

function buildExplanation(results, analysis) {
  if (results.length === 0) {
    return "No relevant local source passed the relevance filter.";
  }

  const sourceSummary = results
    .map((result) => `${result.item.title} (${result.item.source}, score ${result.score})`)
    .join("; ");

  const contradictionSummary = analysis.contradictions.length
    ? ` Potential contradictions found: ${analysis.contradictions.length}.`
    : " No clear contradictions were detected.";

  return `I ranked local sources using keyword overlap, lightweight meaning expansion, phrase matches, and source support. Top sources: ${sourceSummary}.${contradictionSummary}`;
}

function buildSuggestions(results, query) {
  if (results.length === 0) {
    return "Add more scraped pages related to this topic, then ask again.";
  }

  const sources = results.map((result) => result.item.source).join(", ");
  return `Review these local sources for deeper detail: ${sources}. You can also ask a narrower follow-up about "${query}".`;
}

export class ChatEngine {
  constructor(scrapedData = [], options = {}) {
    this.cleanedData = cleanScrapedData(scrapedData);
    this.knowledgeBase = options.knowledgeBase || new KnowledgeBase(options.initialKnowledge);
    this.relevanceEngine = new RelevanceEngine(this.cleanedData);
    this.cache = new Map();
    this.cacheLimit = options.cacheLimit || 100;
  }

  ask(query, userProfile = {}) {
    const profile = normalizeUserProfile(userProfile);
    const cacheKey = JSON.stringify({ query, level: profile.level });
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

    const results = this.relevanceEngine.rank(query, { limit: 5 });
    this.knowledgeBase.learnFromResults(results);
    const relevantFacts = [
      ...factsFromRankedSentences(query, results),
      ...this.knowledgeBase.findRelevantFacts(query)
    ];
    const analysis = analyzeSources(results);
    const bestFacts = relevantFacts.slice(0, 3);
    const directAnswer = adjustForLevel(buildDirectAnswer(query, analysis, relevantFacts), profile.level);
    const hasAnswer = directAnswer !== "No sufficient local data found";
    const confidence = hasAnswer ? confidenceFrom(results, analysis, relevantFacts) : 0;
    const topChunks = hasAnswer ? bestFacts.map((fact) => ({
      text: fact.text,
      source: fact.source,
      topic: fact.topic,
      score: Number((fact.score || 0).toFixed(4))
    })) : [];

    const response = {
      answer: directAnswer,
      confidence,
      sources: hasAnswer ? citationSources(bestFacts) : [],
      chunks: topChunks,
      contradictions: analysis.contradictions,
      "Direct Answer": directAnswer,
      "Explanation": adjustForLevel(buildExplanation(results, analysis), profile.level),
      "Contextual Advice": formatAdvice(profile, analysis.contradictions.length > 0),
      "Suggestions": buildSuggestions(results, query),
      metadata: {
        confidence,
        citations: hasAnswer ? citationSources(bestFacts) : [],
        chunks: topChunks,
        learnedFactCount: this.knowledgeBase.facts.length,
        matchedSources: results.map((result) => ({
          title: result.item.title,
          source: result.item.source,
          score: result.score,
          matchedTokens: result.matchedTokens
        })),
        contradictions: analysis.contradictions
      }
    };

    this.cache.set(cacheKey, response);
    if (this.cache.size > this.cacheLimit) {
      this.cache.delete(this.cache.keys().next().value);
    }
    return response;
  }
}

export function createChatEngine(scrapedData, options) {
  return new ChatEngine(scrapedData, options);
}
