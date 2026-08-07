import { readFile } from "node:fs/promises";

const html = await readFile("dist/index.html", "utf8");
const image = "https://oss.greenways.ai/visual-language/assets/og-hodos.jpg";
const metaTags = [...html.matchAll(/<meta\b[^>]*>/g)].map((match) => match[0]);

function requireMeta(attribute, name, content) {
  const marker = `${attribute}="${name}"`;
  const matches = metaTags.filter((candidate) => candidate.includes(marker));
  if (matches.length !== 1) {
    throw new Error(`Hodos must publish exactly one ${marker}; found ${matches.length}`);
  }
  if (!matches[0].includes(`content="${content}"`)) {
    throw new Error(`Hodos social metadata has the wrong content for ${marker}`);
  }
}

requireMeta("property", "og:image", image);
requireMeta("property", "og:image:secure_url", image);
requireMeta("property", "og:image:type", "image/jpeg");
requireMeta("property", "og:image:width", "1200");
requireMeta("property", "og:image:height", "630");
requireMeta("name", "twitter:image", image);

if (html.includes("og-hodos.png")) {
  throw new Error("Hodos still advertises the oversized PNG social card");
}

console.log("verified Hodos social-preview metadata");
