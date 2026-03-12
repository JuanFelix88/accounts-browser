import path from "node:path";
import fs from "node:fs";
import { connect } from "puppeteer-real-browser";
import { getDataDir } from "./config";
import type { Credential } from "./types";

export async function launchBrowser(
  credential: Credential,
  onDisconnected?: () => void,
): Promise<void> {
  const dataDir = getDataDir();
  // MUST be absolute — chrome-launcher starts Chrome with its own cwd,
  // so a relative path resolves relative to the Chrome executable, not our app.
  const profileDir = path.resolve(dataDir, credential.id);

  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  const { browser, page } = await connect({
    headless: false,
    customConfig: {
      userDataDir: profileDir,
    },
    turnstile: true,
    args: [
      `--user-data-dir=${profileDir}`,
      "--disable-features=LockProfileCookieDatabase,VizDisplayCompositor",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--proxy-server=direct://",
      "--proxy-bypass-list=*",
    ],
  });

  // Set viewport to match the window size
  const session = await page.createCDPSession();
  const { windowId } = await session.send("Browser.getWindowForTarget");
  const { bounds } = await session.send("Browser.getWindowBounds", {
    windowId,
  });
  if (bounds.width && bounds.height) {
    await page.setViewport({
      width: bounds.width,
      height: bounds.height - 100, // account for browser chrome
      deviceScaleFactor: 1,
    });
  }

  browser.on("disconnected", () => {
    onDisconnected?.();
  });
}
