import { normalizeText, splitSentences } from "./tokenizer.js";

const BOILERPLATE_PATTERNS = [
  /\b(advertisement|sponsored|subscribe|cookie policy|privacy policy)\b/i,
  /\b(home|login|sign up|contact|about|menu|navigation)\b/i,
  /\b(buy now|click here|limited offer|newsletter)\b/i
];

function isMeaningfulSentence(sentence) {
  const normalized = normalizeText(sentence);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 5) return false;
  if (BOILERPLATE_PATTERNS.some((pattern) => pattern.test(sentence)) && words.length < 14) {
    return false;
  }

  const hasSignal =
    /\b(is|are|means|contains|removes|should|can|may|because|when|if|for|choose|combine|avoid)\b/i.test(sentence) ||
    /[0-9]/.test(sentence);

  return hasSignal || words.length >= 10;
}

export function dedupeSentences(sentences) {
  const seen = new Set();
  const result = [];

  for (const sentence of sentences) {
    const key = normalizeText(sentence);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(sentence);
  }

  return result;
}

export function cleanScrapedItem(item, id = 0) {
  const title = String(item?.title || "Untitled").trim();
  const source = String(item?.source || `local-source-${id}`).trim();
  const rawSentences = splitSentences(item?.content || "");
  const meaningful = dedupeSentences(rawSentences).filter(isMeaningfulSentence);

  return {
    id,
    title,
    source,
    content: meaningful.join(" "),
    sentences: meaningful
  };
}

export function cleanScrapedData(scrapedData = []) {
  return scrapedData
    .map((item, index) => cleanScrapedItem(item, index))
    .filter((item) => item.content.length > 0 || item.title !== "Untitled");
}
