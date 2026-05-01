import { tokenize } from "./tokenizer.js";

function levenshtein(left, right) {
  if (Math.abs(left.length - right.length) > 2) return 3;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let last = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const temp = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        last + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
      last = temp;
    }
  }
  return previous[right.length];
}

function partialTokenMatch(queryToken, documentToken) {
  if (queryToken.length < 4 || documentToken.length < 4) return false;
  if (documentToken.includes(queryToken) || queryToken.includes(documentToken)) return true;
  if (queryToken.length >= 5 && documentToken.length >= 5 && levenshtein(queryToken, documentToken) <= 1) return true;
  return false;
}

export class BM25Index {
  constructor() {
    this.documents = [];
    this.documentFrequency = new Map();
    this.averageLength = 1;
  }

  build(documents) {
    this.documents = documents.map((document) => {
      const titleTokens = tokenize(document.title);
      const textTokens = tokenize(document.text);
      const tokens = [...titleTokens, ...textTokens];
      const counts = new Map();
      for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
      return {
        ...document,
        tokens,
        titleTokens,
        textTokens,
        tokenSet: new Set(tokens),
        counts,
        length: tokens.length
      };
    });

    this.documentFrequency = new Map();
    for (const document of this.documents) {
      for (const token of new Set(document.tokens)) {
        this.documentFrequency.set(token, (this.documentFrequency.get(token) || 0) + 1);
      }
    }

    const totalLength = this.documents.reduce((sum, document) => sum + document.length, 0);
    this.averageLength = totalLength / Math.max(this.documents.length, 1);
  }

  idf(token) {
    const total = Math.max(this.documents.length, 1);
    const frequency = this.documentFrequency.get(token) || 0;
    return Math.log(1 + (total - frequency + 0.5) / (frequency + 0.5));
  }

  scoreToken(token, document) {
    const frequency = document.counts.get(token) || 0;
    if (!frequency) return 0;
    const k1 = 1.5;
    const b = 0.72;
    const numerator = frequency * (k1 + 1);
    const denominator = frequency + k1 * (1 - b + b * (document.length / this.averageLength));
    return this.idf(token) * (numerator / denominator);
  }

  search(query, limit = 8) {
    const queryTokens = [...new Set(tokenize(query, { expand: true }))];
    if (!queryTokens.length || !this.documents.length) return [];

    return this.documents
      .map((document) => {
        const exactMatches = queryTokens.filter((token) => document.counts.has(token));
        const partialMatches = [];
        for (const token of queryTokens) {
          if (document.counts.has(token)) continue;
          if (document.tokens.some((candidate) => partialTokenMatch(token, candidate))) {
            partialMatches.push(token);
          }
        }
        const matchedTokens = [...new Set([...exactMatches, ...partialMatches])];
        const lexicalScore = queryTokens.reduce((sum, token) => sum + this.scoreToken(token, document), 0);
        const partialScore = partialMatches.length * 0.22;
        const overlap = matchedTokens.length / Math.max(queryTokens.length, 1);
        const textMatchBoost = exactMatches.filter((token) => document.textTokens.includes(token)).length * 0.12;
        const score = lexicalScore + partialScore + overlap + textMatchBoost;
        return {
          ...document,
          score: Number(score.toFixed(4)),
          matchedTokens,
          exactMatches,
          partialMatches
        };
      })
      .filter((result) => result.score > 0 && result.matchedTokens.length > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }
}
