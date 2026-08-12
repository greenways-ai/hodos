import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const entry = readFileSync(new URL("../src/provider-entry.js", import.meta.url), "utf8");
const adapter = readFileSync(new URL("../src/alumbra-provider.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const deploy = readFileSync(new URL("../../../.github/workflows/pages.yml", import.meta.url), "utf8");

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
  assert.match(adapter, /https:\/\/oss\.greenways\.ai/);
  assert.match(adapter, /\/hodos\/alumbra\/apps\/lab\/peacock-ballroom\.html/);
  assert.match(adapter, /ALUMBRA_PROVIDER_RELEASE/);
  assert.match(adapter, /url\.searchParams\.set\("release", ALUMBRA_PROVIDER_RELEASE\)/);
  assert.doesNotMatch(entry, /@greenways\/alumbra/);
  assert.doesNotMatch(adapter, /mesh|shader|canonicalChunk|PlayCanvas/);
});

test("deploys the exact pinned Alumbra host under the existing Hodos Pages site", () => {
  assert.match(deploy, /repository: greenways-ai\/alumbra/);
  assert.match(deploy, /ref: 3eb7d05d047c8600c64b709d33e0542c74a98789/);
  assert.match(deploy, /path: \.alumbra-provider/);
  assert.match(deploy, /site\/dist\/alumbra\/node_modules/);
  assert.match(deploy, /\.alumbra-provider\/apps site\/dist\/alumbra\/apps/);
  assert.match(deploy, /\.alumbra-provider\/packages site\/dist\/alumbra\/packages/);
  assert.match(deploy, /\.alumbra-provider\/node_modules\/playcanvas/);
});
