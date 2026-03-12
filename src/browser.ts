import path from "node:path";
import fs from "node:fs";
import { connect } from "puppeteer-real-browser";
import { getDataDir } from "./config";
import { SessionStore } from "./session-store";
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

  const session = new SessionStore(profileDir);

  const { browser, page } = await connect({
    headless: false,
    customConfig: {},
    turnstile: true,
    args: [
      "--disable-features=LockProfileCookieDatabase,VizDisplayCompositor",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--proxy-server=direct://",
      "--proxy-bypass-list=*",
    ],
  });

  // Restore cookies from our cache before the user navigates
  await session.restore(page);

  // Navigate to the last URL the user was on
  const lastUrl = session.getLastUrl();
  if (lastUrl) {
    await page.goto(lastUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
    await session.restoreLocalStorage(page);
  }

  session.attach(page);
  session.startAutoSave(page);

  // Also hook new tabs/pages opened by the user
  browser.on("targetcreated", async (target) => {
    if (target.type() === "page") {
      const newPage = await target.page();
      if (newPage) {
        await session.restore(newPage);
        session.attach(newPage);
      }
    }
  });

  // Let Chrome manage the viewport size so it resizes with the window
  await page.setViewport(null);

  browser.on("disconnected", async () => {
    await session.finalSave();
    onDisconnected?.();
  });
}
