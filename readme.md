# Local Chat

A simple offline chatbot for local scraped data. No external APIs.

## Run

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## Use

- Ask questions in the chat box.
- Click `Data` to paste or edit scraped data.
- Paste a URL in `Data` and click `Scrape` to pull readable page text.
- Turn on `Follow links` to collect a small same-site crawl.
- Click `Save` to store it locally.
- Saved data is kept in `data/local-scraped-data.json`.

## Data

```js
[
  {
    "title": "Page title",
    "content": "Scraped page text...",
    "source": "local-or-web-source-label"
  }
]
```

## Commands

```bash
npm test
npm run demo
npm run cli -- "What is a local knowledge engine?"
```

## Files

```text
public/index.html      UI
src/server.js          Local server
src/chatEngine.js      Chat pipeline
src/cleaner.js         Data cleaner
src/relevanceEngine.js Search ranking
src/knowledgeBase.js   Memory
src/scraper.js         Local URL scraper
data/sample-scraped-data.json
```
