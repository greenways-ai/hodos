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
page.setDefaultTimeout(120_000);

const githubToken = process.env.GITHUB_TOKEN;
if (githubToken) {
  await page.route("https://api.github.com/**", async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        accept: "application/vnd.github+json",
        authorization: `Bearer ${githubToken}`,
        "x-github-api-version": "2022-11-28",
      },
    });
  });
}

page.on("console", (message) => {
  if (message.type() === "error") console.error(`[browser] ${message.text()}`);
});
page.on("pageerror", (error) => console.error(`[page] ${error.message}`));

const screenshots = [];
async function writeScreenshot(name, clip) {
  const path = resolve(outputRoot, `demo-${name}.png`);
  await page.screenshot({
    path,
    type: "png",
    animations: "disabled",
    timeout: 120_000,
    ...(clip ? { clip } : {}),
  });
  screenshots.push(path);
  console.log(`Captured ${name}`);
}

async function navigate(pathname = "") {
  await page.goto(`${baseUrl}${pathname}`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.waitForSelector("#hodos-app > *", { timeout: 120_000 });
}

async function captureArea(name, selector) {
  await page.waitForSelector(selector, { state: "visible", timeout: 120_000 });
  const clip = await page.evaluate((target) => {
    const node = document.querySelector(target);
    if (!node) return null;
    node.scrollIntoView({ block: "center", inline: "center" });
    const rect = node.getBoundingClientRect();
    const x = Math.max(0, rect.left);
    const y = Math.max(0, rect.top);
    return {
      x,
      y,
      width: Math.max(1, Math.min(rect.right, innerWidth) - x),
      height: Math.max(1, Math.min(rect.bottom, innerHeight) - y),
    };
  }, selector);
  await page.waitForTimeout(500);
  if (!clip) throw new Error(`Could not calculate a capture rectangle for ${selector}`);
  await writeScreenshot(name, clip);
}

async function openWorld(repository, experience = "") {
  const query = new URLSearchParams({ repo: repository });
  if (experience) query.set("experience", experience);
  await navigate(`?${query}`);
  await page.waitForSelector(".world-shell", { timeout: 120_000 });

  await Promise.race([
    page.waitForFunction(
      () => {
        const title = document.querySelector(".world-status strong")?.textContent ?? "";
        return /layers? loaded|incomplete/i.test(title);
      },
      null,
      { timeout: 150_000 },
    ),
    page.waitForSelector(".world-fatal", { timeout: 150_000 }).then(async () => {
      const message = await page.locator(".world-fatal code").textContent();
      throw new Error(message || `Could not open ${repository}`);
    }),
  ]);
  await page.waitForTimeout(3_000);
}

try {
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
  await page.addStyleTag({ content: ".showcase-guide-hero::before{opacity:.06!important}" });
  await captureArea("guided-showcase", ".hodos-surface-frame");

  const studioButton = page.getByRole("button", { name: "Open Studio", exact: true });
  await studioButton.waitFor({ state: "visible", timeout: 60_000 });
  await studioButton.click({ force: true });
  await page.waitForSelector(".studio-app", { timeout: 90_000 });
  await captureArea("studio", ".hodos-surface-frame");

  console.log(`Captured ${screenshots.length} Hodos demo screenshots:`);
  screenshots.forEach((path) => console.log(`- ${path}`));
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
