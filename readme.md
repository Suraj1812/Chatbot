# Local Knowledge Engine

Production-grade local AI-style knowledge engine. It only answers from locally scraped, learned, or approved data. No external LLM APIs and no mock answers.

## Structure

```text
backend/
  src/
    engine/
    routes/
    services/
    utils/
    server.js
frontend/
  src/
    api/
    components/
    store/
    App.jsx
    main.jsx
```

## Install

```bash
npm run install:all
```

## Run

Backend + frontend together:

```bash
npm run start:all
```

Then open:

```text
http://localhost:5173
```

Or run separately.

Terminal 1:

```bash
npm start
```

Terminal 2:

```bash
npm run frontend
```

Open:

```text
http://localhost:5173
```

## API

```text
POST /ask
POST /scrape
POST /learn
GET  /health
```

Backend default:

```text
http://localhost:4000
```

## Behavior

- Scraped and learned data persists in `backend/data/db.json`.
- Answers are extractive and source-backed.
- The backend checks saved local memory first.
- If local confidence is low, it automatically searches public HTML results, scrapes useful pages, saves them locally, rebuilds the index, and asks again.
- If nothing sufficient is found after research, the answer is exactly `No sufficient local data found` with confidence `0`.
- Approved answers are stored and can improve later answers.

## Useful Environment Settings

```bash
PORT=4000
DB_PATH=backend/data/db.json
AUTO_RESEARCH_MAX_PAGES=12
AUTO_RESEARCH_QUERIES=4
ALLOW_PRIVATE_SCRAPE=false
```
