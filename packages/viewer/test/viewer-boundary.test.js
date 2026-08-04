import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("viewer package has no demo registry or branding", () => {
  const source = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const manifest = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.doesNotMatch(source, /FEATURED_WORLDS|teen-explorer|welcome-hero/);
  assert.doesNotMatch(source, /hodos-source-github|hodos-renderer-playcanvas|hodos-world-model/);
  assert.deepEqual(manifest.dependencies, { "@greenways/hodos-core": "0.1.0" });
  assert.match(source, /createHodosViewer/);
  assert.match(source, /onlyContribution\(context, "world\.source"\)/);
});
