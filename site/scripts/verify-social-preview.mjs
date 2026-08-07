import { readFile } from "node:fs/promises";

const html = await readFile("dist/index.html", "utf8");
const image = "https://oss.greenways.ai/visual-language/assets/og-hodos.jpg";

for (const value of [
  `property="og:image" content="${image}"`,
  `property="og:image:secure_url" content="${image}"`,
  `property="og:image:type" content="image/jpeg"`,
  `property="og:image:width" content="1200"`,
  `property="og:image:height" content="630"`,
  `name="twitter:image" content="${image}"`,
]) {
  if (!html.includes(value)) throw new Error(`Hodos social metadata is missing: ${value}`);
}

if (html.includes("og-hodos.png")) {
  throw new Error("Hodos still advertises the oversized PNG social card");
}

console.log("verified Hodos social-preview metadata");
