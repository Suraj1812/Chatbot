import { cleanScrapedData } from "./cleaner.js";
import { KnowledgeBase } from "./knowledgeBase.js";
import { analyzeSources } from "./multiSourceAnalyzer.js";
import { normalizeUserProfile, adjustForLevel, formatAdvice } from "./personalization.js";
import { RelevanceEngine } from "./relevanceEngine.js";
import { tokenize } from "./tokenizer.js";

function buildDirectAnswer(query, analysis, relevantFacts) {
  if (relevantFacts.length > 0) {
    return relevantFacts
      .slice(0, 2)
      .map((fact) => fact.text)
      .join(" ");
  }

  if (analysis.consensus.length > 0) {
    return analysis.consensus
      .slice(0, 2)
      .map((item) => item.text)
      .join(" ");
  }

  return `I could not find enough local scraped data to answer "${query}" reliably.`;
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
        return {
          text: sentence,
          source: result.item.source,
          topic: result.item.title,
          score: overlap * 10 + result.score
        };
      });
    })
    .filter((fact) => fact.score > 0)
    .sort((left, right) => right.score - left.score);
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
  }

  ask(query, userProfile = {}) {
    const profile = normalizeUserProfile(userProfile);
    const cacheKey = JSON.stringify({ query, level: profile.level });
    if (this.cache.has(cacheKey)) {
      return {
        ...this.cache.get(cacheKey),
        cached: true
      };
    }

    const results = this.relevanceEngine.rank(query, { limit: 5 });
    this.knowledgeBase.learnFromResults(results);
    const relevantFacts = [
      ...factsFromRankedSentences(query, results),
      ...this.knowledgeBase.findRelevantFacts(query)
    ];
    const analysis = analyzeSources(results);

    const response = {
      "Direct Answer": adjustForLevel(buildDirectAnswer(query, analysis, relevantFacts), profile.level),
      "Explanation": adjustForLevel(buildExplanation(results, analysis), profile.level),
      "Contextual Advice": formatAdvice(profile, analysis.contradictions.length > 0),
      "Suggestions": buildSuggestions(results, query),
      metadata: {
        matchedSources: results.map((result) => ({
          title: result.item.title,
          source: result.item.source,
          score: result.score,
          matchedTokens: result.matchedTokens
        })),
        contradictions: analysis.contradictions,
        knowledgeBase: this.knowledgeBase.toJSON()
      }
    };

    this.cache.set(cacheKey, response);
    return response;
  }
}

export function createChatEngine(scrapedData, options) {
  return new ChatEngine(scrapedData, options);
}
