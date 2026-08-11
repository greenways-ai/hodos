import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const entry = readFileSync(new URL("../src/provider-entry.js", import.meta.url), "utf8");
const adapter = readFileSync(new URL("../src/alumbra-provider.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("loads a separate provider-world application entry beside the ordinary viewer", () => {
  assert.match(page, /src="\.\/hodos\.js"/);
  assert.match(page, /src="\.\/provider\.js"/);
  assert.match(page, /href="\.\/provider\.css"/);
  assert.match(entry, /resolveWorldGraph/);
  assert.match(entry, /createWorldProviderLaunchIntent/);
  assert.match(entry, /createWorldProviderRegistry/);
  assert.match(entry, /createWorldProviderHost/);
});

test("resolves the repository manifest before allocating the installed provider", () => {
  const resolution = entry.indexOf("await resolveWorldGraph");
  const launch = entry.indexOf("const launch = createWorldProviderLaunchIntent");
  const allocation = entry.indexOf("activeHost = createWorldProviderHost");
  assert.ok(resolution >= 0 && launch > resolution && allocation > launch);
  assert.match(entry, /graph\.project\.provider/);
  assert.match(entry, /graph\.project\.provider\.id !== requestedProvider/);
});

test("keeps Alumbra authority in the application adapter rather than Hodos packages", () => {
  assert.match(adapter, /https:\/\/greenways-ai\.github\.io/);
  assert.match(adapter, /peacock-ballroom\.html/);
  assert.doesNotMatch(entry, /@greenways\/alumbra/);
  assert.doesNotMatch(adapter, /@greenways\/alumbra/);
  assert.doesNotMatch(adapter, /mesh|shader|canonicalChunk|PlayCanvas/);
});
