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
- If local data is missing or irrelevant, the answer is exactly `No sufficient local data found` with confidence `0`.
- Approved answers are stored and can improve later answers.
