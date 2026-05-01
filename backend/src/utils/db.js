import fs from "node:fs";
import path from "node:path";
import { Low } from "lowdb";

const defaultData = {
  documents: [],
  facts: [],
  approvedAnswers: [],
  feedback: [],
  queries: []
};

class AtomicJsonFile {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async read() {
    if (!fs.existsSync(this.filePath)) return null;
    return JSON.parse(await fs.promises.readFile(this.filePath, "utf8"));
  }

  async write(data) {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.promises.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`);
    await fs.promises.rename(tempPath, this.filePath);
  }
}

export async function createDb() {
  const filePath = process.env.DB_PATH || path.resolve("backend/data/db.json");
  const db = new Low(new AtomicJsonFile(filePath), structuredClone(defaultData));
  await db.read();
  db.data ||= structuredClone(defaultData);
  for (const [key, value] of Object.entries(defaultData)) {
    if (!Array.isArray(db.data[key])) db.data[key] = value;
  }
  await db.write();
  return db;
}
