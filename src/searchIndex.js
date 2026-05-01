import { expandTokens, stemToken, tokenize } from "./tokenizer.js";

export class SearchIndex {
  constructor(items = []) {
    this.items = [];
    this.invertedIndex = new Map();
    this.documentFrequency = new Map();
    this.addMany(items);
  }

  addMany(items) {
    for (const item of items) {
      this.add(item);
    }
  }

  add(item) {
    const text = `${item.title} ${item.content}`;
    const tokens = tokenize(text).map(stemToken);
    const tokenCounts = new Map();

    for (const token of tokens) {
      tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
    }

    const indexed = {
      ...item,
      tokens,
      tokenCounts
    };

    this.items.push(indexed);

    for (const token of new Set(tokens)) {
      if (!this.invertedIndex.has(token)) this.invertedIndex.set(token, new Set());
      this.invertedIndex.get(token).add(indexed.id);
      this.documentFrequency.set(token, (this.documentFrequency.get(token) || 0) + 1);
    }
  }

  search(query) {
    const queryTokens = expandTokens(tokenize(query).map(stemToken));
    const candidates = new Set();

    for (const token of queryTokens) {
      for (const id of this.invertedIndex.get(token) || []) {
        candidates.add(id);
      }
    }

    if (candidates.size === 0) {
      for (const item of this.items) candidates.add(item.id);
    }

    return [...candidates]
      .map((id) => this.items.find((item) => item.id === id))
      .filter(Boolean);
  }

  idf(token) {
    const documents = Math.max(this.items.length, 1);
    const frequency = this.documentFrequency.get(token) || 0;
    return Math.log((documents + 1) / (frequency + 1)) + 1;
  }
}
