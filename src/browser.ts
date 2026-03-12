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
  const profileDir = path.join(dataDir, credential.id);

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
      "--start-maximized",
      // Disable OS-level cookie/secret encryption so profiles are portable across machines
      "--disable-features=LockProfileCookieDatabase",
      "--password-store=basic",
      "--use-mock-keychain",
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
