import assert from "node:assert/strict";
import test from "node:test";
import { createRigDocument } from "@greenways/hodos-world-model/rigging";
import {
  RiggingWeightStrokeController,
  normalizeRigWeightPaintSettings,
  rigWeightPaintEdit,
} from "../src/rigging-weight-painter.js";

function rig() {
  return createRigDocument({
    id: "rig:paint",
    assetId: "sha256:paint",
    joints: [
      { id: "root", parent: null },
      { id: "tip", parent: "root", rest: { translation: [0, 1, 0] } },
    ],
    skin: { weightSetId: "weights:sha256:base", maxInfluences: 4 },
    bind: { inverseMatricesId: "bind:sha256:base" },
  });
}

function fakeHost() {
  let next = 1;
  const released = [];
  const discarded = [];
  const previews = new Map();
  return {
    released,
    discarded,
    selectWeightSphere(_handle, options) {
      return { id: `selection:${next++}`, count: Math.max(1, Math.round(options.center[0] + 2)) };
    },
    unionWeightSelections(_handle, ids) {
      return { id: `selection:${next++}`, sources: [...ids] };
    },
    releaseWeightSelection(_handle, id) { released.push(id); return true; },
    async previewWeightEdit(_handle, _document, baseWeightSetId, selectionId, edit) {
      const preview = { id: `preview:${next++}`, baseWeightSetId, selectionId, edit, affectedVertices: 4 };
      previews.set(preview.id, preview);
      return preview;
    },
    discardWeightPreview(_handle, id) { discarded.push(id); previews.delete(id); return true; },
    commitWeightPreview(_handle, id) {
      assert.ok(previews.has(id));
      previews.delete(id);
      return {
        skin: { handleType: "rig/weights", weightSetId: "weights:sha256:committed", maxInfluences: 4 },
        bind: { inverseMatricesId: "bind:sha256:base" },
        evidence: { affectedVertices: 4 },
      };
    },
  };
}

test("paint settings and edits preserve explicit operation parameters", () => {
  const settings = normalizeRigWeightPaintSettings({ operation: "smooth", radius: 0.5, strength: 0.75, iterations: 2 });
  assert.equal(settings.radius, 0.5);
  assert.equal(settings.strength, 0.75);
  assert.equal(rigWeightPaintEdit(rig(), "tip", settings).operation, "smooth");
  assert.throws(() => rigWeightPaintEdit(rig(), null, { operation: "add" }), /active joint/);
});

test("stroke previews accumulate selections and commit one artifact", async () => {
  const host = fakeHost();
  const events = [];
  const controller = new RiggingWeightStrokeController({
    assetHost: host,
    onPreview: (event) => events.push(event.type),
    onCommit: (event) => events.push(event.type),
  });
  controller.configure({
    handle: "rig-asset:1",
    document: rig(),
    baseWeightSetId: "weights:sha256:base",
    jointId: "tip",
    settings: { operation: "add", radius: 0.25, strength: 0.2 },
  });
  await controller.begin([0, 0, 0]);
  await controller.move([1, 0, 0]);
  const result = await controller.finish();
  assert.equal(result.skin.weightSetId, "weights:sha256:committed");
  assert.deepEqual(events, ["preview", "preview", "commit"]);
  assert.ok(host.released.length >= 3);
  assert.equal(controller.isActive(), false);
});

test("cancelling a stroke discards preview and releases selection", async () => {
  const host = fakeHost();
  const controller = new RiggingWeightStrokeController({ assetHost: host });
  controller.configure({
    handle: "rig-asset:1",
    document: rig(),
    baseWeightSetId: "weights:sha256:base",
    jointId: "tip",
    settings: { operation: "replace" },
  });
  await controller.begin([0, 0, 0]);
  await controller.cancel();
  assert.equal(host.discarded.length, 1);
  assert.equal(host.released.length, 1);
  assert.equal(controller.isActive(), false);
});

test("pointer movement coalesces while an async sphere selection is pending", async () => {
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const host = fakeHost();
  let calls = 0;
  const originalSelect = host.selectWeightSphere;
  host.selectWeightSphere = async (...arguments_) => {
    calls += 1;
    if (calls === 1) await gate;
    return originalSelect(...arguments_);
  };
  const previews = [];
  const controller = new RiggingWeightStrokeController({
    assetHost: host,
    onPreview: (event) => previews.push(event.preview.selectionId),
  });
  controller.configure({
    handle: "rig-asset:1",
    document: rig(),
    baseWeightSetId: "weights:sha256:base",
    jointId: "tip",
    settings: { operation: "add" },
  });
  const beginning = controller.begin([0, 0, 0]);
  await Promise.resolve();
  const moving = controller.move([2, 0, 0]);
  releaseFirst();
  await Promise.all([beginning, moving]);
  assert.equal(calls, 2);
  assert.equal(previews.length, 2);
  await controller.cancel();
});

test("cancellation during an async selection releases the eventual selection without deadlock", async () => {
  let releaseSelection;
  const gate = new Promise((resolve) => { releaseSelection = resolve; });
  const host = fakeHost();
  const originalSelect = host.selectWeightSphere;
  host.selectWeightSphere = async (...arguments_) => {
    await gate;
    return originalSelect(...arguments_);
  };
  const controller = new RiggingWeightStrokeController({ assetHost: host });
  controller.configure({
    handle: "rig-asset:1",
    document: rig(),
    baseWeightSetId: "weights:sha256:base",
    jointId: "tip",
    settings: { operation: "add" },
  });
  const beginning = controller.begin([0, 0, 0]);
  await Promise.resolve();
  const cancelling = controller.cancel();
  releaseSelection();
  await Promise.all([beginning, cancelling]);
  assert.equal(controller.isActive(), false);
  assert.equal(host.released.length, 1);
  assert.equal(host.discarded.length, 0);
});
