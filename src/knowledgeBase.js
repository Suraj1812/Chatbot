import { normalizeText, tokenize } from "./tokenizer.js";

function uniquePush(collection, value, keySelector = (item) => normalizeText(item)) {
  const key = keySelector(value);
  if (!key) return false;
  const exists = collection.some((item) => keySelector(item) === key);
  if (exists) return false;
  collection.push(value);
  return true;
}

export class KnowledgeBase {
  constructor(initial = {}) {
    this.topics = initial.topics || [];
    this.facts = initial.facts || [];
    this.summaries = initial.summaries || [];
  }

  learnFromResults(results = []) {
    for (const result of results) {
      const { item } = result;
      uniquePush(this.topics, item.title);

      for (const sentence of item.sentences || []) {
        if (this.looksLikeFact(sentence)) {
          uniquePush(this.facts, {
            text: sentence,
            source: item.source,
            topic: item.title
          }, (fact) => normalizeText(fact.text));
        }
      }

      const summary = this.summarizeItem(item);
      if (summary) {
        uniquePush(this.summaries, {
          topic: item.title,
          source: item.source,
          summary
        }, (entry) => `${normalizeText(entry.topic)}:${normalizeText(entry.summary)}`);
      }
    }
  }

  looksLikeFact(sentence) {
    return /\b(is|are|means|contains|removes|should|can|may|because|when|if|choose|combine|avoid)\b/i.test(sentence);
  }

  summarizeItem(item) {
    const sentences = item.sentences || [];
    if (sentences.length === 0) return "";
    return sentences.slice(0, 2).join(" ");
  }

  findRelevantFacts(query, limit = 5) {
    const queryTerms = new Set(tokenize(query));
    return this.facts
      .map((fact) => {
        const factTerms = new Set(tokenize(fact.text));
        let overlap = 0;
        for (const term of queryTerms) {
          if (factTerms.has(term)) overlap += 1;
        }
        return { ...fact, score: overlap };
      })
      .filter((fact) => fact.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  toJSON() {
    return {
      topics: this.topics,
      facts: this.facts,
      summaries: this.summaries
    };
  }
}
