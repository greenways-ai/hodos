import assert from "node:assert/strict";
import test from "node:test";
import {
  addRigJoint,
  createRigDocument,
  createRiggingSession,
} from "@greenways/hodos-world-model/rigging";
import { createLocalRiggingAssetHost } from "../src/rigging-asset-host.js";
import { destroyRigWeightHeatmapSample } from "../src/rigging-weight-heatmap.js";
import { createStylizedUnriggedGlb } from "./fixtures/stylized-unrigged-glb.js";

async function setup() {
  const host = createLocalRiggingAssetHost({ id: "heatmap-host" });
  const opened = await host.open(createRiggingSession({ id: "session:heatmap" }), createStylizedUnriggedGlb());
  assert.equal(opened.ok, true);
  let rig = createRigDocument({ id: "rig:heatmap", assetId: opened.source.contentId });
  rig = addRigJoint(rig, { id: "root", parent: null, rest: { translation: [0, 0, 0] } });
  rig = addRigJoint(rig, { id: "ornament", parent: "root", rest: { translation: [3, 0, 0] } });
  const bound = await host.bindRig(opened.handle, rig, { strategy: "rigid-component" });
  rig = { ...rig, skin: bound.skin, bind: bound.bind };
  return { host, opened, rig, bound };
}

test("host projects accepted and preview weight artifacts through bounded samples", async () => {
  const { host, opened, rig, bound } = await setup();
  let accepted = null;
  let previewSample = null;
  try {
    accepted = host.weightHeatmap(opened.handle, bound.weightSetId, 1, { maximumPoints: 9 });
    assert.equal(accepted.count, 9);
    assert.ok(accepted.positions instanceof Float32Array);
    assert.ok(accepted.values instanceof Float32Array);
    assert.equal(JSON.stringify(accepted.evidence).includes("Float32Array"), false);

    const selection = await host.selectWeightSphere(opened.handle, { center: [3, 0, 0], radius: 2 });
    const preview = await host.previewWeightEdit(
      opened.handle,
      rig,
      bound.weightSetId,
      selection.id,
      { operation: "add", jointIndex: 1, strength: 0.25 },
    );
    previewSample = host.weightPreviewHeatmap(opened.handle, preview.id, 1, { maximumPoints: 9 });
    assert.equal(previewSample.artifactId, preview.id);
    assert.equal(previewSample.count, 9);
    const committed = host.commitWeightPreview(opened.handle, preview.id);
    assert.match(committed.weightSetId, /^weights:sha256:/);
    host.releaseWeightSelection(opened.handle, selection.id);
  } finally {
    destroyRigWeightHeatmapSample(accepted);
    destroyRigWeightHeatmapSample(previewSample);
    host.destroy();
  }
});
