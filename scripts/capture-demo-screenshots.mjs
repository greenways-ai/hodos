import { createServer } from "node:http";
import { mkdir, readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const distRoot = resolve(repositoryRoot, "apps/demo/dist");
const outputRoot = resolve(repositoryRoot, "apps/demo/public");
const host = "127.0.0.1";
const port = 4173;
const baseUrl = `http://${host}:${port}/`;

const mime = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

function safePath(url) {
  const pathname = decodeURIComponent(new URL(url, baseUrl).pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const path = resolve(distRoot, relative);
  if (path !== distRoot && !path.startsWith(`${distRoot}${sep}`)) return null;
  return path;
}

const server = createServer(async (request, response) => {
  try {
    let path = safePath(request.url ?? "/");
    if (!path) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    try {
      if ((await stat(path)).isDirectory()) path = resolve(path, "index.html");
    } catch {
      path = resolve(distRoot, "index.html");
    }
    const body = await readFile(path);
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": mime.get(extname(path)) ?? "application/octet-stream",
    });
    response.end(body);
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(error.stack ?? String(error));
  }
});

await mkdir(outputRoot, { recursive: true });
await new Promise((resolveListen, reject) => {
  server.once("error", reject);
  server.listen(port, host, resolveListen);
});

const browser = await chromium.launch({
  headless: true,
  args: [
    "--disable-dev-shm-usage",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-angle=swiftshader",
  ],
});

const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});
await context.addInitScript(() => {
  localStorage.setItem("hodos-theme", "dark");
});

const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") console.error(`[browser] ${message.text()}`);
});
page.on("pageerror", (error) => console.error(`[page] ${error.message}`));

const screenshots = [];
const writeScreenshot = async (name, options = {}) => {
  const path = resolve(outputRoot, `demo-${name}.png`);
  await page.screenshot({
    path,
    type: "png",
    animations: "disabled",
    ...options,
  });
  screenshots.push(path);
};

async function navigate(pathname = "") {
  await page.goto(`${baseUrl}${pathname}`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.waitForSelector("#hodos-app > *", { timeout: 120_000 });
}

async function captureElement(name, selector) {
  const element = page.locator(selector).first();
  await element.waitFor({ state: "visible", timeout: 60_000 });
  const path = resolve(outputRoot, `demo-${name}.png`);
  await element.screenshot({
    path,
    type: "png",
    animations: "disabled",
  });
  screenshots.push(path);
}

async function openWorld(repository, experience = "") {
  const query = new URLSearchParams({ repo: repository });
  if (experience) query.set("experience", experience);
  await navigate(`?${query}`);
  await page.waitForSelector(".world-shell", { timeout: 120_000 });
  await page.waitForFunction(
    () => {
      const title = document.querySelector(".world-status strong")?.textContent ?? "";
      return /layers? loaded|incomplete/i.test(title);
    },
    null,
    { timeout: 180_000 },
  ).catch(() => {});
  await page.waitForTimeout(3_000);
}

try {
  await navigate();
  await captureElement("platform-journey", ".showcase-landing");

  await openWorld("https://github.com/greenways-worlds/splat-garden", "editor");
  await page.waitForSelector(".hodos-world-editor", { timeout: 90_000 });
  await writeScreenshot("world-editor");

  await openWorld("https://github.com/greenways-worlds/playbot");
  await page.addStyleTag({ content: ".hodos-world-editor,.world-draft-review-root{display:none!important}" });
  await writeScreenshot("playbot-world");

  await openWorld("https://github.com/greenways-worlds/apartment");
  await page.addStyleTag({ content: ".hodos-world-editor,.world-draft-review-root{display:none!important}" });
  await writeScreenshot("apartment-world");

  await openWorld("https://github.com/greenways-worlds/splat-garden", "showcase");
  await page.waitForSelector(".showcase-guide", { timeout: 90_000 });
  await captureElement("guided-showcase", ".hodos-surface-frame");

  const openedStudio = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const target = buttons.find((button) => /studio/i.test(button.textContent ?? ""));
    target?.click();
    return Boolean(target);
  });
  if (!openedStudio) throw new Error("Could not find the Studio action in the guided experience");
  await page.waitForSelector(".studio-app", { timeout: 90_000 });
  await captureElement("studio", ".hodos-surface-frame");

  await navigate(`?${new URLSearchParams({ repo: "https://github.com/greenways-worlds/not-a-world" })}`);
  await page.waitForSelector(".world-fatal", { timeout: 120_000 });
  await writeScreenshot("load-failure");

  console.log(`Captured ${screenshots.length} Hodos demo screenshots:`);
  screenshots.forEach((path) => console.log(`- ${path}`));
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
