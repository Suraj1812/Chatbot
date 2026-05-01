import axios from "axios";
import * as cheerio from "cheerio";
import { hashText } from "../utils/hash.js";

const MAX_HTML_BYTES = 2_000_000;
const USER_AGENT = "LocalKnowledgeEngine/1.0";

function cleanWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeUrl(rawUrl, baseUrl) {
  try {
    const url = new URL(rawUrl, baseUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function extractLinks($, baseUrl, limit = 12) {
  const base = new URL(baseUrl);
  const links = [];
  const seen = new Set([baseUrl]);

  $("a[href]").each((_, element) => {
    if (links.length >= limit) return;
    const href = normalizeUrl($(element).attr("href"), baseUrl);
    if (!href || seen.has(href)) return;
    const url = new URL(href);
    if (url.origin !== base.origin) return;
    if (/\.(pdf|png|jpe?g|gif|webp|zip|mp4|mp3|svg)$/i.test(url.pathname)) return;
    seen.add(href);
    links.push(href);
  });

  return links;
}

function extractContent(html, source) {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, nav, footer, aside, form, iframe").remove();
  $("[class*='ad'], [id*='ad'], [class*='cookie'], [id*='cookie'], [class*='promo'], [class*='newsletter'], [class*='sidebar']").remove();

  const title = cleanWhitespace($("meta[property='og:title']").attr("content") || $("title").first().text() || source);
  const root = $("article").first().length ? $("article").first() : $("main").first().length ? $("main").first() : $("body");
  const paragraphs = [];

  root.find("h1,h2,h3,p,li").each((_, element) => {
    const text = cleanWhitespace($(element).text());
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length < 6) return;
    if (/^(home|menu|login|sign up|subscribe|privacy|terms|cookie)$/i.test(text)) return;
    paragraphs.push(text);
  });

  const seen = new Set();
  const content = paragraphs
    .filter((paragraph) => {
      const key = paragraph.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 180)
    .join("\n");

  return { title, content };
}

export async function scrapeUrl(url) {
  const normalized = normalizeUrl(url);
  if (!normalized || !/^https?:\/\//i.test(normalized)) {
    throw new Error(`Invalid URL: ${url}`);
  }

  const response = await axios.get(normalized, {
    timeout: 12000,
    maxContentLength: MAX_HTML_BYTES,
    responseType: "text",
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml"
    },
    validateStatus: (status) => status >= 200 && status < 400
  });

  const contentType = response.headers["content-type"] || "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
    throw new Error("URL did not return HTML.");
  }

  const $ = cheerio.load(response.data);
  const { title, content } = extractContent(response.data, normalized);
  if (!content) throw new Error("No meaningful content extracted.");

  const timestamp = new Date().toISOString();
  return {
    document: {
      title,
      content,
      source: normalized,
      hash: hashText(`${title}\n${content}`),
      timestamp,
      lastUpdated: timestamp,
      type: "scraped"
    },
    links: extractLinks($, normalized)
  };
}

export async function scrapeUrls(urls, { depth = 0, maxPages = 10 } = {}) {
  const queue = [...new Set(urls.map((url) => normalizeUrl(url)).filter(Boolean))];
  const visited = new Set();
  const documents = [];
  const errors = [];

  while (queue.length && documents.length < maxPages) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);

    try {
      const result = await scrapeUrl(url);
      documents.push(result.document);
      if (depth > 0) {
        for (const link of result.links) {
          if (!visited.has(link) && queue.length + documents.length < maxPages) queue.push(link);
        }
      }
    } catch (error) {
      errors.push({ source: url, error: error.message });
    }
  }

  return { documents, errors };
}
