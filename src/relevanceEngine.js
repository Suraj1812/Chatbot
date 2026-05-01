import { SearchIndex } from "./searchIndex.js";
import { expandTokens, jaccardSimilarity, stemToken, tokenize } from "./tokenizer.js";

function phraseScore(query, item) {
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) return 0;
  const text = `${item.title} ${item.content}`.toLowerCase();
  if (text.includes(normalizedQuery)) return 0.35;

  const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);
  const bigrams = [];
  for (let index = 0; index < queryWords.length - 1; index += 1) {
    bigrams.push(`${queryWords[index]} ${queryWords[index + 1]}`);
  }

  const matches = bigrams.filter((bigram) => text.includes(bigram)).length;
  return bigrams.length === 0 ? 0 : (matches / bigrams.length) * 0.2;
}

export class RelevanceEngine {
  constructor(cleanedData = []) {
    this.index = new SearchIndex(cleanedData);
  }

  rank(query, { limit = 5 } = {}) {
    const queryTokens = expandTokens(tokenize(query).map(stemToken));
    const candidates = this.index.search(query);

    return candidates
      .map((item) => {
        let keywordScore = 0;
        for (const token of queryTokens) {
          keywordScore += this.index.bm25(token, item);
        }

        const semanticScore = jaccardSimilarity(queryTokens, item.tokens);
        const titleBoost = jaccardSimilarity(queryTokens, tokenize(item.title).map(stemToken)) * 1.6;
        const score = keywordScore * 0.9 + semanticScore * 1.1 + titleBoost + phraseScore(query, item);

        return {
          item,
          score: Number(score.toFixed(4)),
          matchedTokens: queryTokens.filter((token) => item.tokenCounts.has(token))
        };
      })
      .filter((result) => result.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }
}
