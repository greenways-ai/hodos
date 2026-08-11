import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {parseEDNString} from "../src/vendor/edn-data-1.1.2.js";
import {parseProjectEdn, readWorldProject} from "../src/world-manifest.js";

const options = Object.freeze({
  mapAs: "object",
  setAs: "array",
  listAs: "array",
  keywordAs: "string",
  charAs: "string",
  objectKeysAs: "string",
});

const providerManifest = `
; Provider-backed worlds have no ordinary layer path.
{:hara/type :project
 :hara/version "1.0.0"
 :project/id alumbra-hara/peacock-ballroom
 :project/version "0.1.0"
 :project/source-paths ["packages/hara/src"]
 :project/test-paths ["packages/hara/test"]
 :project/extension-paths []
 :project/capabilities #{:canvas/webgl2 :input/pointer}
 :project/world
 {:world/version "1.0.0"
  :world/title "Peacock \\"Ballroom\\""
  :world/provider
  {:provider/id alumbra/world
   :provider/activity alumbra-hara/peacock-ballroom
   :provider/package "hara:greenways/alumbra-peacock-ballroom@0.1.0"
   :provider/default-state ballroom/day
   :provider/states [ballroom/day ballroom/gallery-overlook ballroom/mosaic-floor]}}}
`;

test("the source-github manifest graph has no unresolved browser dependency", async () => {
  const source = await readFile(new URL("../src/world-manifest.js", import.meta.url), "utf8");
  assert.match(source, /from "\.\/vendor\/edn-data-1\.1\.2\.js"/);
  assert.doesNotMatch(source, /from "edn-data"/);
  assert.doesNotMatch(source, /node:|require\(|process\./);
});

test("the pinned ESM parser preserves the manifest EDN shapes Hodos consumes", () => {
  const value = parseEDNString(`
    {:keyword :value
     :symbol some/name
     :vector [1 -2 3.5 true false nil]
     :set #{:one :two}
     :list (:a :b)
     :char \\space
     :discard #_ :ignored "kept"
     :instant #inst "2026-08-11T00:00:00.000Z"}
  `, options);

  assert.equal(value.keyword, "value");
  assert.deepEqual(value.symbol, {sym: "some/name"});
  assert.deepEqual(value.vector, [1, -2, 3.5, true, false, null]);
  assert.deepEqual(value.set, ["one", "two"]);
  assert.deepEqual(value.list, ["a", "b"]);
  assert.equal(value.char, " ");
  assert.equal(value.discard, "kept");
  assert.equal(value.instant.toISOString(), "2026-08-11T00:00:00.000Z");
});

test("provider-backed project.edn parses without node_modules or an import map", () => {
  const parsed = parseProjectEdn(providerManifest);
  assert.equal(parsed["project/id"].sym, "alumbra-hara/peacock-ballroom");
  assert.deepEqual(parsed["project/capabilities"], ["canvas/webgl2", "input/pointer"]);

  const project = readWorldProject(providerManifest);
  assert.equal(project.id, "alumbra-hara/peacock-ballroom");
  assert.equal(project.title, 'Peacock "Ballroom"');
  assert.deepEqual(project.layers, []);
  assert.deepEqual(project.imports, []);
  assert.equal(project.provider.id, "alumbra/world");
  assert.equal(project.provider.activity, "alumbra-hara/peacock-ballroom");
  assert.equal(project.provider.defaultState, "ballroom/day");
  assert.deepEqual(project.provider.states, [
    "ballroom/day",
    "ballroom/gallery-overlook",
    "ballroom/mosaic-floor",
  ]);
});

test("the vendored parser retains the exact upstream provenance and MIT notice", async () => {
  const parser = await readFile(new URL("../src/vendor/edn-data-1.1.2.js", import.meta.url), "utf8");
  const license = await readFile(new URL("../src/vendor/edn-data-LICENSE.txt", import.meta.url), "utf8");
  assert.match(parser, /edn-data 1\.1\.2/);
  assert.match(parser, /1e5824f63803eb58f35e98839352000053d47115/);
  assert.match(parser, /Copyright \(c\) 2020 Jorin Vogel/);
  assert.match(license, /The MIT License \(MIT\)/);
  assert.match(license, /Copyright \(c\) 2020 Jorin Vogel/);
});
