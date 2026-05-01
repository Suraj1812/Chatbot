# Local Intelligent Scraper + Knowledge Engine Chatbot

Dependency-free Node.js chatbot that answers questions using only local scraped data.

## Features

- Cleans scraped content by removing ads, navigation text, repeated sentences, and low-value lines.
- Builds an in-memory keyword and lightweight semantic search index.
- Ranks sources by relevance.
- Stores reusable topics, facts, and summaries in an in-memory knowledge base.
- Performs simple multi-source consensus and contradiction detection.
- Personalizes answer complexity for `beginner`, `intermediate`, or `advanced` users.
- Includes a CLI and a minimal local web UI.
- Uses no external APIs and no network calls for intelligence.

## Data Format

```js
[
  {
    "title": "Page title",
    "content": "Scraped page text...",
    "source": "local-or-web-source-label"
  }
]
```

## Quick Start

```bash
npm test
npm run demo
npm run cli -- "What is a local knowledge engine?"
npm start
```

Then open:

```text
http://localhost:3000
```

## CLI Examples

```bash
npm run cli -- "What should I choose for a beginner chatbot?" --level beginner
npm run cli -- "How does the relevance engine rank content?" --data ./data/sample-scraped-data.json
```

## Project Structure

```text
src/
  chatEngine.js             Main query pipeline
  cleaner.js                Scraped text cleaning
  knowledgeBase.js          Topics, facts, summaries memory
  multiSourceAnalyzer.js    Consensus and conflict analysis
  relevanceEngine.js        Query matching and ranking
  searchIndex.js            In-memory index
  personalization.js        User level adjustment
  server.js                 Local web UI and API
  cli.js                    Command line interface
public/
  index.html                Minimal local UI
data/
  sample-scraped-data.json  Example scraped data
```

## Notes

The built-in semantic matching is intentionally local and lightweight. It uses token normalization, phrase overlap, topic expansion, and source consensus rather than external embeddings.
