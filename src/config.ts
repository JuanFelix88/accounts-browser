import { config } from "dotenv";
import path from "node:path";

config();

// Resolve relative to the script location (src/ or dist/), not process.cwd().
// This ensures ./data and creds.json are found regardless of where the app is launched from.
const APP_ROOT = path.resolve(__dirname, "..");

export function getCredsPath(): string {
  return path.resolve(
    process.env.CREDS_PATH || path.join(APP_ROOT, "creds.json"),
  );
}

export function getDataDir(): string {
  return path.resolve(process.env.DATA_DIR || path.join(APP_ROOT, "data"));
}
