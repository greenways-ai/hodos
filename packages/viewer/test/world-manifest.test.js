import assert from "node:assert/strict";
import test from "node:test";
import { readWorldProject } from "../src/world-manifest.js";

const manifest = `
{:hara/type :project
 :hara/version "1.0.0"
 :project/id greenways.example/fern-gully
 :project/version "1.2.0"
 :project/source-paths ["src"]
 :project/test-paths ["test"]
 :project/extension-paths []
 :project/capabilities [:canvas/webgl2 :input/pointer :ui/dom-surface]
 :project/world
 {:world/version "1.0.0"
  :world/title "Fern Gully"
  :world/background "#102018"
  :world/camera {:world/position [1 2 3] :world/target [0 1 0] :world/fov 55}
  :world/layers [{:world/id grove :world/asset "world/grove.sog"
                  :world/transform {:world/position [2 0 0] :world/rotation [0 90 0] :world/scale 0.5}}]
  :world/touchpoints [{:touchpoint/id mixing-desk
                       :touchpoint/label "Open Studio"
                       :touchpoint/position [1 0.8 -2]
                       :touchpoint/radius 0.7
                       :touchpoint/surface hodos/studio
                       :touchpoint/presentation :focus-overlay
                       :touchpoint/config {:project "local/current"}}]
  :world/imports [{:world/id creek :world/repository "https://github.com/greenways/creek"
                   :world/ref "0123456789012345678901234567890123456789"}]}}
`;

test("reads and normalizes a world project with touchpoints", () => {
  const project = readWorldProject(manifest);
  assert.equal(project.id, "greenways.example/fern-gully");
  assert.equal(project.layers[0].asset, "world/grove.sog");
  assert.deepEqual(project.layers[0].transform, { position: [2, 0, 0], rotation: [0, 90, 0], scale: 0.5 });
  assert.equal(project.imports[0].transform.scale, 1);
  assert.deepEqual(project.capabilities, ["canvas/webgl2", "input/pointer", "ui/dom-surface"]);
  assert.deepEqual(project.touchpoints[0], {
    id: "mixing-desk",
    label: "Open Studio",
    surface: "hodos/studio",
    presentation: "focus-overlay",
    anchor: "world",
    position: [1, 0.8, -2],
    radius: 0.7,
    camera: null,
    config: { project: "local/current" },
  });
});

test("rejects paths that leave the repository", () => {
  assert.throws(() => readWorldProject(manifest.replace("world/grove.sog", "../grove.sog")), /repository-relative|parent segments/);
});

test("requires browser capabilities", () => {
  assert.throws(() => readWorldProject(manifest.replace(":canvas/webgl2 ", "")), /canvas\/webgl2/);
});

test("touchpoints require the trusted DOM surface capability", () => {
  assert.throws(() => readWorldProject(manifest.replace(" :ui/dom-surface", "")), /ui\/dom-surface/);
});
