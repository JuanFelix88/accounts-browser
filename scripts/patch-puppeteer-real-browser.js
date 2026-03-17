/**
 * Patches puppeteer-real-browser to handle TargetCloseError.
 *
 * Problem: Chrome's initial page can close before pageController finishes
 * calling evaluateOnNewDocument, causing a TargetCloseError that crashes the app.
 *
 * Fixes:
 * 1. pageController.js — wraps evaluateOnNewDocument + createCursor in try-catch
 * 2. index.js — retries with a fresh page if the initial pageController call fails
 */

const fs = require("fs");
const path = require("path");

const libDir = path.join(
  __dirname,
  "..",
  "node_modules",
  "puppeteer-real-browser",
  "lib",
  "cjs",
);

const PATCH_MARKER = "// PATCHED-PRB";

/* ------------------------------------------------------------------ */
/*  1. Patch pageController.js                                        */
/* ------------------------------------------------------------------ */

const pcPath = path.join(libDir, "module", "pageController.js");
const pcOriginal = fs.readFileSync(pcPath, "utf-8");

if (pcOriginal.includes(PATCH_MARKER)) {
  console.log("puppeteer-real-browser already patched.");
  process.exit(0);
}

const pcPatched = pcOriginal
  // Wrap evaluateOnNewDocument in try-catch
  .replace(
    /await page\.evaluateOnNewDocument\(\(\) => \{/,
    `try { await page.evaluateOnNewDocument(() => {`,
  )
  .replace(
    /\}\);\s*\n\s*const cursor = createCursor/,
    `});
    } catch (_patchErr) { /* page may have closed — skip override */ }

    const cursor = createCursor`,
  )
  // Wrap cursor creation in try-catch
  .replace(
    /const cursor = createCursor\(page\);\s*\n\s*page\.realCursor = cursor\s*\n\s*page\.realClick = cursor\.click/,
    `${PATCH_MARKER}
    try {
      const cursor = createCursor(page);
      page.realCursor = cursor;
      page.realClick = cursor.click;
    } catch (_patchErr) { /* page may have closed — skip cursor */ }`,
  );

fs.writeFileSync(pcPath, pcPatched, "utf-8");
console.log("✅ Patched puppeteer-real-browser/pageController.js");

/* ------------------------------------------------------------------ */
/*  2. Patch index.js — retry initial pageController with fresh page  */
/* ------------------------------------------------------------------ */

const idxPath = path.join(libDir, "index.js");
const idxOriginal = fs.readFileSync(idxPath, "utf-8");

const idxPatched = idxOriginal.replace(
  /page = await pageController\(\{\s*\n?\s*\.\.\.pageControllerConfig,\s*\n?\s*killProcess:\s*true,\s*\n?\s*chrome,\s*\n?\s*\}\);/,
  `${PATCH_MARKER}
  {
    let _retries = 3;
    while (_retries > 0) {
      try {
        page = await pageController({
          ...pageControllerConfig,
          killProcess: true,
          chrome,
        });
        break;
      } catch (_err) {
        _retries--;
        if (_retries === 0) throw _err;
        await new Promise(r => setTimeout(r, 500));
        const _pages = await browser.pages();
        if (_pages.length > 0) {
          page = _pages[_pages.length - 1];
          pageControllerConfig.page = page;
        }
      }
    }
  }`,
);

fs.writeFileSync(idxPath, idxPatched, "utf-8");
console.log("✅ Patched puppeteer-real-browser/index.js");
