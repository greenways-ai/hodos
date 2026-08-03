import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("viewer package has no demo registry or branding", () => {
  const source = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /FEATURED_WORLDS|teen-explorer|welcome-hero/);
  assert.match(source, /createHodosViewer/);
});
