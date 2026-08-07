import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const config = new URL("../astro.config.mjs", import.meta.url);

test("Hodos publishes complete JPEG social-preview metadata", async () => {
  const source = await readFile(config, "utf8");

  assert.match(source, /og-hodos\.jpg/);
  assert.match(source, /og:image:secure_url/);
  assert.match(source, /og:image:type/);
  assert.match(source, /image\/jpeg/);
  assert.match(source, /og:image:width/);
  assert.match(source, /content: "1200"/);
  assert.match(source, /og:image:height/);
  assert.match(source, /content: "630"/);
  assert.match(source, /twitter:image:alt/);
  assert.doesNotMatch(source, /og-hodos\.png/);
});
