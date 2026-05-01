import axios from "axios";
import * as cheerio from "cheerio";
import dns from "node:dns/promises";
import net from "node:net";
import { hashText } from "../utils/hash.js";

const MAX_HTML_BYTES = 2_000_000;
const MIN_CONTENT_WORDS = 25;
const SCRAPE_CONCURRENCY = 3;
const USER_AGENT = "LocalKnowledgeEngine/1.0 (+local offline knowledge scraper)";

function cleanWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeUrl(rawUrl, baseUrl) {
  try {
    const url = new URL(rawUrl, baseUrl);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) url.searchParams.delete(key);
    }
    if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
      url.port = "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

function isPrivateIp(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      address === "0.0.0.0";
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:");
  }
  return false;
}

async function assertSafeUrl(normalized) {
  if (process.env.ALLOW_PRIVATE_SCRAPE === "true") return;

  const url = new URL(normalized);
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) {
    throw new Error("Private/local URLs are blocked by default. Set ALLOW_PRIVATE_SCRAPE=true to allow them.");
  }
  if (net.isIP(host) && isPrivateIp(host)) {
    throw new Error("Private network URLs are blocked by default.");
  }

  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  if (addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new Error("URL resolves to a private network address.");
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

function isBoilerplate(text) {
  if (/^(home|menu|login|sign up|subscribe|privacy|terms|cookie|contact|about)$/i.test(text)) return true;
  if (/\b(cookie|newsletter|subscribe|advertisement|sponsored|all rights reserved|privacy policy|terms of service)\b/i.test(text)) return true;
  if (/^(share|follow|read more|previous|next)\b/i.test(text)) return true;
  return false;
}

function hasNoiseAttribute(value) {
  const normalized = String(value || "").toLowerCase();
  if (!normalized) return false;
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.some((token) => {
    return token === "ad" ||
      token === "ads" ||
      token === "advert" ||
      token === "advertisement" ||
      token === "cookie" ||
      token === "cookies" ||
      token === "promo" ||
      token === "promoted" ||
      token === "newsletter" ||
      token === "sidebar" ||
      token === "modal" ||
      token === "banner";
  });
}

function extractContent(html, source) {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, nav, footer, aside, form, iframe, header").remove();
  $("sup.reference, .reference, .references, .reflist, .mw-references-wrap, .navbox, .metadata, .ambox, .hatnote, .printfooter").remove();
  $("[class], [id]").each((_, element) => {
    const className = $(element).attr("class");
    const id = $(element).attr("id");
    if (hasNoiseAttribute(className) || hasNoiseAttribute(id)) $(element).remove();
  });

  const title = cleanWhitespace($("meta[property='og:title']").attr("content") || $("title").first().text() || source);
  const root = $("article").first().length ? $("article").first() : $("main").first().length ? $("main").first() : $("body");
  const paragraphs = [];
  const description = cleanWhitespace($("meta[name='description']").attr("content") || $("meta[property='og:description']").attr("content"));
  if (description && !isBoilerplate(description)) paragraphs.push(description);

  root.find("h1,h2,h3,p,li").each((_, element) => {
    const text = cleanWhitespace($(element).text());
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length < 6) return;
    if (words.length > 140) return;
    if (isBoilerplate(text)) return;
    paragraphs.push(text);
  });

  const seen = new Set();
  const content = paragraphs
    .filter((paragraph) => {
      const key = paragraph.toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 220);
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
  await assertSafeUrl(normalized);

  const response = await axios.get(normalized, {
    timeout: 12000,
    maxRedirects: 3,
    maxContentLength: MAX_HTML_BYTES,
    responseType: "text",
    transformResponse: [(value) => value],
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
  const finalUrl = normalizeUrl(response.request?.res?.responseUrl || normalized);
  if (finalUrl && finalUrl !== normalized) await assertSafeUrl(finalUrl);

  const $ = cheerio.load(response.data);
  const { title, content } = extractContent(response.data, finalUrl || normalized);
  if (!content || content.split(/\s+/).length < MIN_CONTENT_WORDS) throw new Error("No meaningful content extracted.");

  const timestamp = new Date().toISOString();
  return {
    document: {
      title,
      content,
      source: finalUrl || normalized,
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
  const contentHashes = new Set();
  const documents = [];
  const errors = [];

  while (queue.length && documents.length < maxPages) {
    const batch = [];
    while (queue.length && batch.length < SCRAPE_CONCURRENCY && documents.length + batch.length < maxPages) {
      const url = queue.shift();
      if (!url || visited.has(url)) continue;
      visited.add(url);
      batch.push(url);
    }
    if (!batch.length) continue;

    const settled = await Promise.all(batch.map(async (url) => {
      try {
        const result = await scrapeUrl(url);
        return { ok: true, url, result };
      } catch (error) {
        return { ok: false, url, error };
      }
    }));

    for (const item of settled) {
      if (!item.ok) {
        errors.push({ source: item.url, error: item.error.message });
        continue;
      }

      const { document, links } = item.result;
      if (!contentHashes.has(document.hash)) {
        contentHashes.add(document.hash);
        documents.push(document);
      }

      if (depth > 0) {
        for (const link of links) {
          if (!visited.has(link) && queue.length + documents.length < maxPages) queue.push(link);
        }
      }
    }
  }

  return { documents, errors };
}
