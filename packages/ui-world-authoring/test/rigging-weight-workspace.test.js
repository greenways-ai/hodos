import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(new URL("../src/rigging-workspace.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/rigging-workspace.css", import.meta.url), "utf8");
const renderer = await readFile(new URL("../../renderer-playcanvas/src/rigging-authoring-renderer.js", import.meta.url), "utf8");

test("workspace exposes skin activity, deterministic binding and bounded brush controls", () => {
  for (const token of [
    "Skin / Weights",
    "Bind smooth",
    "Bind components",
    "Weight paint operation",
    "bindRigWeights",
    "diagnoseRigWeights",
    "setRigWeightSettings",
  ]) assert.match(workspace, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("renderer preserves preview/release as one skin-attach boundary", () => {
  assert.match(renderer, /RiggingWeightStrokeController/);
  assert.match(renderer, /weightPreviewHeatmap/);
  assert.match(renderer, /finishRigWeightStroke/);
  assert.match(renderer, /type: "rig\/skin-attach"/);
  assert.match(renderer, /pointercancel/);
  assert.match(renderer, /cancelRigWeightStroke/);
});

test("heat map and mobile controls remain overlay-only and touch-safe", () => {
  assert.match(styles, /hodos-rigging-weight-heatmap/);
  assert.match(styles, /pointer-events: none/);
  assert.match(styles, /min-block-size: 44px/);
  assert.match(styles, /forced-colors: active/);
});
