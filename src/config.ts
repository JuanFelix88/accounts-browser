import { config } from "dotenv";
import path from "node:path";

config();

export function getCredsPath(): string {
  return process.env.CREDS_PATH || path.join(process.cwd(), "creds.json");
}

export function getDataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}
