import assert from "node:assert/strict";
import test from "node:test";
import { readWorldProject } from "../src/world-manifest.js";
import { WORLD_PROVIDER_FORMAT } from "../src/world-provider.js";

const providerManifest = `
{:hara/type :project
 :hara/version "1.0.0"
 :project/id greenways/peacock-ballroom
 :project/version "0.1.0"
 :project/source-paths ["src"]
 :project/test-paths ["test"]
 :project/extension-paths []
 :project/capabilities [:canvas/webgl2 :input/pointer]
 :project/world
 {:world/version "1.0.0"
  :world/title "Peacock Ballroom"
  :world/background "#102018"
  :world/provider
  {:provider/id alumbra/world
   :provider/activity alumbra-hara/peacock-ballroom
   :provider/package "hara:greenways/alumbra-peacock-ballroom@0.1.0"
   :provider/default-state ballroom/day
   :provider/states [ballroom/day
                     ballroom/gallery-overlook
                     ballroom/mosaic-floor]}}}
`;

const emptyManifest = `
{:hara/type :project
 :hara/version "1.0.0"
 :project/id greenways/empty-world
 :project/version "0.1.0"
 :project/source-paths ["src"]
 :project/test-paths ["test"]
 :project/extension-paths []
 :project/capabilities [:canvas/webgl2 :input/pointer]
 :project/world {:world/version "1.0.0"}}
`;

test("reads a provider-only world without a dummy SOG layer", () => {
  const project = readWorldProject(providerManifest);
  assert.equal(project.id, "greenways/peacock-ballroom");
  assert.deepEqual(project.layers, []);
  assert.deepEqual(project.imports, []);
  assert.deepEqual(project.provider, {
    format: WORLD_PROVIDER_FORMAT,
    id: "alumbra/world",
    activity: "alumbra-hara/peacock-ballroom",
    package: "hara:greenways/alumbra-peacock-ballroom@0.1.0",
    defaultState: "ballroom/day",
    states: [
      "ballroom/day",
      "ballroom/gallery-overlook",
      "ballroom/mosaic-floor",
    ],
  });
});

test("still requires one static or installed world source", () => {
  assert.throws(() => readWorldProject(emptyManifest), /layer, import, or provider/);
});

test("fails provider manifest validation before graph or host allocation", () => {
  assert.throws(
    () => readWorldProject(providerManifest.replace("ballroom/day\n   :provider/states", "ballroom/evening\n   :provider/states")),
    /must occur/,
  );
  assert.throws(
    () => readWorldProject(providerManifest.replace(
      ":provider/package \"hara:greenways/alumbra-peacock-ballroom@0.1.0\"",
      ":provider/package \"https://example.test/engine.js\"",
    )),
    /exact hara: or npm:/,
  );
});
