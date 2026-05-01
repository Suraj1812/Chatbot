import axios from "axios";
import * as cheerio from "cheerio";
import { tokenOverlap, uniqueTokens } from "../engine/tokenizer.js";

function decodeDuckDuckGoUrl(value) {
  try {
    const url = new URL(value, "https://duckduckgo.com");
    const uddg = url.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : url.toString();
  } catch {
    return "";
  }
}

function normalizeResultUrl(value) {
  const decoded = decodeDuckDuckGoUrl(value);
  try {
    const url = new URL(decoded);
    url.hash = "";
    if (!/^https?:$/.test(url.protocol)) return "";
    if (/\.(pdf|png|jpe?g|gif|webp|zip|mp4|mp3|svg)$/i.test(url.pathname)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

export async function searchWeb(query, { limit = 8 } = {}) {
  const response = await axios.get("https://html.duckduckgo.com/html/", {
    timeout: 12000,
    responseType: "text",
    params: { q: query },
    headers: {
      "user-agent": "LocalKnowledgeEngine/1.0",
      accept: "text/html"
    }
  });

  const $ = cheerio.load(response.data);
  const results = [];
  const seen = new Set();

  $(".result").each((index, resultElement) => {
    if (results.length >= limit) return;
    const link = $(resultElement).find(".result__a, a[href*='uddg=']").first();
    const href = link.attr("href");
    const source = normalizeResultUrl(href);
    if (!source || seen.has(source)) return;
    seen.add(source);
    const title = link.text().replace(/\s+/g, " ").trim() || source;
    const snippet = $(resultElement).find(".result__snippet").text().replace(/\s+/g, " ").trim();
    results.push({
      title,
      snippet,
      source,
      query,
      rank: index + 1,
      score: scoreSearchResult(query, { title, snippet, source, rank: index + 1 })
    });
  });

  return results;
}

function scoreSearchResult(query, result) {
  const queryTokens = uniqueTokens(query);
  const titleTokens = uniqueTokens(result.title);
  const snippetTokens = uniqueTokens(result.snippet || "");
  let score = 1 / Math.max(result.rank || 1, 1);
  score += tokenOverlap(queryTokens, titleTokens) * 1.4;
  score += tokenOverlap(queryTokens, snippetTokens) * 0.7;

  try {
    const url = new URL(result.source);
    const host = url.hostname.replace(/^www\./, "");
    const hostTokens = uniqueTokens(host.replace(/[.-]/g, " "));
    score += tokenOverlap(queryTokens, hostTokens) * 0.7;
    if (url.protocol === "https:") score += 0.15;
    if (/\b(docs|developer|support|help|learn|wiki|wikipedia|github)\b/i.test(host)) score += 0.2;
    if (/\b(youtube|facebook|instagram|pinterest|tiktok|linkedin|reddit|quora)\b/i.test(host)) score -= 0.5;
    if (url.pathname.split("/").filter(Boolean).length > 5) score -= 0.15;
  } catch {
    score -= 1;
  }

  return Number(score.toFixed(4));
}
