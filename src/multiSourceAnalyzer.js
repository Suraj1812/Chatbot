import { normalizeText, tokenize } from "./tokenizer.js";

const CONTRADICTION_PATTERNS = [
  [/\bshould\b/i, /\bshould not\b|\bavoid\b/i],
  [/\bcan\b/i, /\bcannot\b|\bcan't\b/i],
  [/\bis\b/i, /\bis not\b|\bisn't\b/i],
  [/\brequires\b/i, /\bdoes not require\b/i]
];

function sentenceKey(sentence) {
  return tokenize(sentence).slice(0, 10).join(" ");
}

export function analyzeSources(results = []) {
  const allSentences = [];

  for (const result of results) {
    for (const sentence of result.item.sentences || []) {
      allSentences.push({
        text: sentence,
        source: result.item.source,
        score: result.score
      });
    }
  }

  const grouped = new Map();
  for (const sentence of allSentences) {
    const key = sentenceKey(sentence);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(sentence);
  }

  const consensus = [...grouped.values()]
    .map((group) => ({
      text: group[0].text,
      sources: [...new Set(group.map((item) => item.source))],
      support: group.length,
      score: group.reduce((sum, item) => sum + item.score, 0)
    }))
    .sort((left, right) => right.support - left.support || right.score - left.score);

  return {
    consensus,
    contradictions: detectContradictions(allSentences),
    sourceCount: new Set(allSentences.map((sentence) => sentence.source)).size
  };
}

export function detectContradictions(sentences = []) {
  const contradictions = [];

  for (let leftIndex = 0; leftIndex < sentences.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sentences.length; rightIndex += 1) {
      const left = sentences[leftIndex];
      const right = sentences[rightIndex];
      if (left.source === right.source) continue;

      const leftText = normalizeText(left.text);
      const rightText = normalizeText(right.text);
      const sharedTerms = tokenize(leftText).filter((term) => tokenize(rightText).includes(term));
      if (sharedTerms.length < 3) continue;

      const conflicts = CONTRADICTION_PATTERNS.some(([positive, negative]) => {
        return (positive.test(left.text) && negative.test(right.text)) || (negative.test(left.text) && positive.test(right.text));
      });

      if (conflicts) {
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
