#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createChatEngine } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDataPath = path.resolve(__dirname, "../data/local-scraped-data.json");

function parseArgs(argv) {
  const args = {
    query: "",
    data: defaultDataPath,
    level: "intermediate"
  };

  const queryParts = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--data") {
      args.data = path.resolve(argv[++index]);
    } else if (value === "--level") {
      args.level = argv[++index];
    } else {
      queryParts.push(value);
    }
  }

  args.query = queryParts.join(" ").trim();
  return args;
}

function loadScrapedData(dataPath) {
  return JSON.parse(fs.readFileSync(dataPath, "utf8"));
}

const args = parseArgs(process.argv.slice(2));
if (!args.query) {
  console.log("Usage: npm run cli -- \"your question\" --level beginner --data ./data/local-scraped-data.json");
  process.exit(0);
}

const data = fs.existsSync(args.data) ? loadScrapedData(args.data) : [];
const engine = createChatEngine(data);
const response = engine.ask(args.query, { level: args.level });
console.log(JSON.stringify(response, null, 2));
