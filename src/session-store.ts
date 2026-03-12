import fs from "node:fs";
import path from "node:path";

// Use a loose type to avoid conflicts between puppeteer-core, rebrowser-puppeteer-core,
// and puppeteer-real-browser which all expose slightly different Page types.
interface PageLike {
  url(): string;
  cookies(): Promise<any[]>;
  setCookie(...cookies: any[]): Promise<void>;
  evaluate(fn: any, ...args: any[]): Promise<any>;
  createCDPSession(): Promise<CDPSessionLike>;
  on(event: string, handler: (...args: any[]) => void): void;
}

interface CDPSessionLike {
  send(method: string, params?: any): Promise<any>;
  detach(): Promise<void>;
}

interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

interface LocalStorageEntry {
  origin: string;
  data: Record<string, string>;
}

interface SessionData {
  cookies: StoredCookie[];
  localStorage: LocalStorageEntry[];
  lastUrl?: string;
}

/**
 * Manages cookie and localStorage persistence for a browser profile.
 * Data is stored as JSON files inside the profile directory.
 */
export class SessionStore {
  private filePath: string;
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private pages = new Set<PageLike>();

  constructor(profileDir: string) {
    this.filePath = path.join(profileDir, "session-data.json");
  }

  /* ------------------------------------------------------------------ */
  /*  READ / WRITE                                                      */
  /* ------------------------------------------------------------------ */

  private read(): SessionData {
    try {
      if (fs.existsSync(this.filePath)) {
        return JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      }
    } catch {
      // corrupted file — start fresh
    }
    return { cookies: [], localStorage: [] };
  }

  /**
   * Returns the last URL the user was on, if any.
   */
  getLastUrl(): string | undefined {
    return this.read().lastUrl;
  }

  private write(data: SessionData): void {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  /* ------------------------------------------------------------------ */
  /*  RESTORE — call after browser connects, before user navigates      */
  /* ------------------------------------------------------------------ */

  async restore(page: PageLike): Promise<void> {
    const data = this.read();
    if (data.cookies.length > 0) {
      const cdp = await page.createCDPSession();
      await cdp.send("Network.setCookies", { cookies: data.cookies as any[] });
      await cdp.detach();
    }
  }

  /**
   * Restore localStorage for the current page origin.
   * Must be called AFTER the page has navigated to the target origin.
   */
  async restoreLocalStorage(page: PageLike): Promise<void> {
    const data = this.read();
    if (data.localStorage.length === 0) return;

    try {
      const origin = new URL(page.url()).origin;
      const entry = data.localStorage.find((e) => e.origin === origin);
      if (entry && Object.keys(entry.data).length > 0) {
        await page.evaluate((items: Record<string, string>) => {
          for (const [k, v] of Object.entries(items)) {
            localStorage.setItem(k, v);
          }
        }, entry.data);
      }
    } catch {
      // page may be about:blank or chrome:// — ignore
    }
  }

  /* ------------------------------------------------------------------ */
  /*  SAVE — capture current state from the browser                     */
  /* ------------------------------------------------------------------ */

  async save(page: PageLike): Promise<void> {
    try {
      const data = this.read();

      // --- Cookies (all domains via CDP) ---
      const cdp = await page.createCDPSession();
      const { cookies } = await cdp.send("Network.getAllCookies");
      await cdp.detach();
      data.cookies = cookies.map((c: any) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
        ...(c.sameSite && c.sameSite !== "None"
          ? { sameSite: c.sameSite }
          : {}),
      }));

      // --- Last URL ---
      const url = page.url();
      if (url && url !== "about:blank" && !url.startsWith("chrome")) {
        data.lastUrl = url;
      }

      // --- localStorage for current origin ---
      await this.captureLocalStorage(page, data);

      this.write(data);
    } catch {
      // browser may have closed mid-save — ignore
    }
  }

  private async captureLocalStorage(
    page: PageLike,
    data: SessionData,
  ): Promise<void> {
    try {
      const url = page.url();
      if (!url || url === "about:blank" || url.startsWith("chrome")) return;

      const origin = new URL(url).origin;
      const items: Record<string, string> = await page.evaluate(() => {
        const obj: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) obj[key] = localStorage.getItem(key) ?? "";
        }
        return obj;
      });

      const idx = data.localStorage.findIndex((e) => e.origin === origin);
      if (idx >= 0) {
        data.localStorage[idx].data = items;
      } else {
        data.localStorage.push({ origin, data: items });
      }
    } catch {
      // ignore — page context may have been destroyed
    }
  }

  /* ------------------------------------------------------------------ */
  /*  ATTACH — hooks into page events for automatic save/restore        */
  /* ------------------------------------------------------------------ */

  attach(page: PageLike): void {
    this.pages.add(page);

    // Restore localStorage after each navigation completes
    page.on("load", async () => {
      await this.restoreLocalStorage(page);
    });

    // Save cookies + localStorage on each completed navigation
    page.on("framenavigated", async () => {
      await this.save(page);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  LIFECYCLE                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Start periodic saves (safety net in case events are missed).
   */
  startAutoSave(page: PageLike, intervalMs = 15_000): void {
    this.stopAutoSave();
    this.saveTimer = setInterval(() => {
      this.save(page).catch(() => {});
    }, intervalMs);
  }

  stopAutoSave(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
  }

  /**
   * Final save of ALL tracked pages before shutdown.
   */
  async finalSave(): Promise<void> {
    for (const page of this.pages) {
      try {
        await this.save(page);
      } catch {
        // ignore
      }
    }
    this.stopAutoSave();
  }
}
