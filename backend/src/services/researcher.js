import { uniqueTokens } from "../engine/tokenizer.js";
import { scrapeUrls } from "./scraper.js";
import { searchWeb } from "./webSearch.js";

const DEFAULT_SEARCH_QUERIES = 4;
const DEFAULT_SEARCH_LIMIT = 7;
const DEFAULT_MAX_RESULTS = 16;
const DEFAULT_MAX_PAGES = 12;

function cleanQuery(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function titleCaseToken(token) {
  if (!token) return token;
  return `${token[0].toUpperCase()}${token.slice(1)}`;
}

export function buildSearchQueries(query, { limit = DEFAULT_SEARCH_QUERIES } = {}) {
  const original = cleanQuery(query);
  const keywords = uniqueTokens(original).slice(0, 8);
  const phrase = keywords.join(" ");
  const titlePhrase = keywords.map(titleCaseToken).join(" ");
  const variants = new Set([original]);

  if (keywords.length) {
    variants.add(`${phrase} overview`);
    variants.add(`${phrase} official`);
    variants.add(`${phrase} documentation OR guide`);
  }

  if (/^(what is|who is|define|tell me about)\b/i.test(original) && phrase) {
    variants.add(`${titlePhrase} definition`);
  }

  if (/^(how|how to|how do|how does)\b/i.test(original) && phrase) {
    variants.add(`${phrase} steps guide`);
  }

  return [...variants].filter(Boolean).slice(0, limit);
}

function mergeSearchResults(results) {
  const bySource = new Map();
  for (const result of results) {
    const existing = bySource.get(result.source);
    if (!existing || result.score > existing.score) bySource.set(result.source, result);
  }
  return [...bySource.values()].sort((left, right) => right.score - left.score);
}

export async function researchQuery(query, options = {}) {
  const {
    queryLimit = DEFAULT_SEARCH_QUERIES,
    searchLimit = DEFAULT_SEARCH_LIMIT,
    maxResults = DEFAULT_MAX_RESULTS,
    maxPages = DEFAULT_MAX_PAGES
  } = options;
  const queries = buildSearchQueries(query, { limit: queryLimit });
  const searchErrors = [];
  const searchResponses = await Promise.allSettled(queries.map((searchQuery) => searchWeb(searchQuery, { limit: searchLimit })));
  const found = [];

  searchResponses.forEach((response, index) => {
    if (response.status === "fulfilled") {
      found.push(...response.value);
    } else {
      searchErrors.push({ source: queries[index], error: response.reason?.message || "Search failed." });
    }
  });

  const searchResults = mergeSearchResults(found).slice(0, maxResults);
  const scrapeResult = await scrapeUrls(searchResults.map((result) => result.source), {
    depth: 0,
    maxPages
  });

  return {
    queries,
    searchResults,
    documents: scrapeResult.documents,
    errors: [...searchErrors, ...scrapeResult.errors]
  };
}
