import crypto from "node:crypto";
import { splitSentences } from "./tokenizer.js";

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_HTML_BYTES = 2_000_000;
const USER_AGENT = "LocalKnowledgeChatbot/1.0";

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function removeBoilerplateHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/<[^>]+(class|id)=["'][^"']*(advert|ad-|cookie|newsletter|subscribe|promo|sidebar)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, " ");
}

function stripHtml(html) {
  return decodeHtml(
    removeBoilerplateHtml(html)
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|section|article|main|li|h[1-6]|br)>/gi, ". ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function getTagContent(html, pattern) {
  const match = String(html || "").match(pattern);
  return match ? stripHtml(match[1]).trim() : "";
}

function getTitle(html, fallback) {
  const ogTitle = getTagContent(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  const title = getTagContent(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  return ogTitle || title || fallback;
}

function extractReadableHtml(html) {
  const cleaned = removeBoilerplateHtml(html);
  const article = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  const main = cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  return article || main || cleaned;
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

function extractSameHostLinks(html, baseUrl, limit) {
  const base = new URL(baseUrl);
  const links = [];
  const seen = new Set([base.toString()]);
  const pattern = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = pattern.exec(String(html || ""))) && links.length < limit) {
    const normalized = normalizeUrl(match[1], baseUrl);
    if (!normalized || seen.has(normalized)) continue;
    const candidate = new URL(normalized);
    if (candidate.origin !== base.origin) continue;
    if (!/^https?:$/.test(candidate.protocol)) continue;
    if (/\.(pdf|png|jpg|jpeg|gif|webp|zip|mp4|mp3)$/i.test(candidate.pathname)) continue;
    seen.add(normalized);
    links.push(normalized);
  }

  return links;
}

async function fetchHtml(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml"
      }
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) {
      throw new Error("URL did not return HTML.");
    }

    const reader = response.body?.getReader();
    if (!reader) return await response.text();

    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > MAX_HTML_BYTES) {
        throw new Error("Page is too large to scrape safely.");
      }
      chunks.push(value);
    }

    return new TextDecoder().decode(Buffer.concat(chunks));
  } finally {
    clearTimeout(timeout);
  }
}

export function scrapeHtml(html, source = "local-html") {
  const readableHtml = extractReadableHtml(html);
  const title = getTitle(html, source);
  const text = stripHtml(readableHtml);
  const content = splitSentences(text)
    .filter((sentence) => sentence.split(/\s+/).length >= 5)
    .slice(0, 160)
    .join(" ");

  return {
    title,
    content,
    source,
    scrapedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    contentHash: crypto.createHash("sha256").update(`${title}\n${content}`).digest("hex")
  };
}

export async function scrapeUrl(url) {
  const normalized = normalizeUrl(url);
  if (!normalized || !/^https?:\/\//i.test(normalized)) {
    throw new Error(`Invalid URL: ${url}`);
  }

  const html = await fetchHtml(normalized);
  return {
    item: scrapeHtml(html, normalized),
    links: extractSameHostLinks(html, normalized, 12)
  };
}

export async function scrapeUrls(urls = [], options = {}) {
  const maxPages = Math.min(Number(options.maxPages || 10), 25);
  const depth = Math.min(Number(options.depth || 0), 1);
  const queue = [...new Set(urls.map((url) => normalizeUrl(url)).filter(Boolean))];
  const visited = new Set();
  const scraped = [];
  const errors = [];

  while (queue.length && scraped.length < maxPages) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);

    try {
      const result = await scrapeUrl(url);
      scraped.push(result.item);
      if (depth > 0) {
        for (const link of result.links) {
          if (!visited.has(link) && queue.length + scraped.length < maxPages) {
            queue.push(link);
          }
        }
      }
    } catch (error) {
      errors.push({ source: url, error: error.message });
    }
  }

  return { scraped, errors };
}
