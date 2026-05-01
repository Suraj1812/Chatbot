import { tokenize } from "./tokenizer.js";

export class BM25Index {
  constructor() {
    this.documents = [];
    this.documentFrequency = new Map();
    this.averageLength = 1;
  }

  build(documents) {
    this.documents = documents.map((document) => {
      const tokens = tokenize(`${document.title} ${document.text}`);
      const counts = new Map();
      for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
      return { ...document, tokens, counts, length: tokens.length };
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
    const queryTokens = tokenize(query, { expand: true });
    if (!queryTokens.length || !this.documents.length) return [];

    return this.documents
      .map((document) => {
        const matchedTokens = queryTokens.filter((token) => document.counts.has(token));
        const lexicalScore = queryTokens.reduce((sum, token) => sum + this.scoreToken(token, document), 0);
        const partialScore = queryTokens.reduce((sum, token) => {
          if (document.counts.has(token)) return sum;
          return sum + document.tokens.some((candidate) => candidate.includes(token) || token.includes(candidate)) * 0.18;
        }, 0);
        const overlap = matchedTokens.length / Math.max(queryTokens.length, 1);
        const score = lexicalScore + partialScore + overlap;
        return { ...document, score: Number(score.toFixed(4)), matchedTokens };
      })
      .filter((result) => result.score > 0 && result.matchedTokens.length > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }
}
