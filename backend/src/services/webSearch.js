import axios from "axios";
import * as cheerio from "cheerio";

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

  $(".result__a, a.result__url, a[href*='uddg=']").each((_, element) => {
    if (results.length >= limit) return;
    const href = $(element).attr("href");
    const source = normalizeResultUrl(href);
    if (!source || seen.has(source)) return;
    seen.add(source);
    results.push({
      title: $(element).text().replace(/\s+/g, " ").trim() || source,
      source
    });
  });

  return results;
}
