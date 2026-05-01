import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Low } from "lowdb";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../..");

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
    this.writeQueue = Promise.resolve();
  }

  async read() {
    if (!fs.existsSync(this.filePath)) return null;
    try {
      return JSON.parse(await fs.promises.readFile(this.filePath, "utf8"));
    } catch (error) {
      const backupPath = `${this.filePath}.corrupt-${Date.now()}`;
      await fs.promises.rename(this.filePath, backupPath);
      throw new Error(`Local database JSON was invalid. Moved it to ${backupPath}. ${error.message}`);
    }
  }

  async write(data) {
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.promises.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`);
      await fs.promises.rename(tempPath, this.filePath);
    });
    return this.writeQueue;
  }
}

export async function createDb() {
  const filePath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(backendRoot, "data/db.json");
  const db = new Low(new AtomicJsonFile(filePath), structuredClone(defaultData));
  await db.read();
  db.data ||= structuredClone(defaultData);
  for (const [key, value] of Object.entries(defaultData)) {
    if (!Array.isArray(db.data[key])) db.data[key] = value;
  }
  await db.write();
  return db;
}
