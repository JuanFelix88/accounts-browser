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

  const connectArgs = {
    headless: false as const,
    customConfig: {},
    turnstile: true,
    args: [
      "--disable-features=LockProfileCookieDatabase,VizDisplayCompositor",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--no-proxy-server",
    ],
  };

  type ConnectResult = Awaited<ReturnType<typeof connect>>;
  let result: ConnectResult | undefined;
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      result = await connect(connectArgs);
      break;
    } catch (err) {
      const isTargetClose =
        err instanceof Error && err.constructor.name === "TargetCloseError";
      if (attempt === MAX_RETRIES || !isTargetClose) throw err;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
  const { browser, page } = result!;

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
