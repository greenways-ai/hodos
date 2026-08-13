import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  createMixamoAnimationDemoState,
  MIXAMO_ANIMATION_DEMO_EXPERIENCE,
  reduceMixamoAnimationDemoState,
} from "../src/mixamo-animation-demo-model.js";

test("the reference demo exposes a dedicated, rights-clean Animation Lab", () => {
  const html = fs.readFileSync(new URL("../animation.html", import.meta.url), "utf8");
  const entry = fs.readFileSync(new URL("../src/mixamo-animation-entry.js", import.meta.url), "utf8");
  assert.match(html, /Hodos Animation Lab/);
  assert.match(html, /id="hodos-animation-demo"/);
  assert.match(html, /\.\/animation\.js/);
  assert.match(entry, /createAnimationWorkbench/);
  assert.match(entry, /data-character-file/);
  assert.match(entry, /data-animation-files/);
  assert.match(entry, /Create a quick browser wave/);
  assert.match(entry, /playSequence/);
  assert.doesNotMatch(`${html}\n${entry}`, /mixamo\.com\/.*\.(fbx|glb)|adobe\.com\/.*\.(fbx|glb)/i);
  assert.equal(MIXAMO_ANIMATION_DEMO_EXPERIENCE, "animation");
});

test("animation demo state stays portable across authoring and sequencing", () => {
  let state = createMixamoAnimationDemoState({
    clips: [
      { id: "idle", duration: 2, loop: true, resourceId: "builtin:hodos/idle" },
      { id: "wave", duration: 1.4, resourceId: "authored:wave" },
    ],
  });
  state = reduceMixamoAnimationDemoState(state, {
    type: "animation/pose-captured",
    key: { at: 0, joints: { "right-arm": [0, 0, 0, 1] } },
  });
  state = reduceMixamoAnimationDemoState(state, {
    type: "animation/sequence-add",
    item: { id: "cue:idle", clipId: "idle" },
  });
  const encoded = JSON.stringify(state);
  assert.match(encoded, /builtin:hodos\/idle/);
  assert.doesNotMatch(encoded, /ArrayBuffer|Float32Array|AnimTrack|playcanvas|Entity/i);
  assert.equal(state.poseKeys.length, 1);
  assert.equal(state.sequence.length, 1);
});

test("compact animation controls do not rely on hover or bundled third-party files", () => {
  const styles = fs.readFileSync(new URL("../src/mixamo-animation-demo.css", import.meta.url), "utf8");
  const entry = fs.readFileSync(new URL("../src/mixamo-animation-entry.js", import.meta.url), "utf8");
  assert.match(styles, /touch-action:\s*none/);
  assert.match(styles, /@media \(max-width: 820px\)/);
  assert.match(entry, /data-mobile-tab/);
  assert.match(entry, /Local files never leave this browser/);
  assert.doesNotMatch(entry, /\.focus\(/);
  assert.doesNotMatch(entry, /fetch\([^)]*\.glb/i);
});
