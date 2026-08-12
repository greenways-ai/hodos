import assert from "node:assert/strict";
import test from "node:test";
import {
  addRigJoint,
  attachRigSkin,
  createRigDocument,
  createRiggingSession,
} from "@greenways/hodos-world-model/rigging";
import { createLocalRiggingAssetHost } from "../src/rigging-asset-host.js";
import { createStylizedUnriggedGlb } from "./fixtures/stylized-unrigged-glb.js";

async function setup() {
  const host = createLocalRiggingAssetHost({ id: "host-edit" });
  const opened = await host.open(createRiggingSession({ id: "session:host-edit" }), createStylizedUnriggedGlb());
  let rig = createRigDocument({ id: "rig:host-edit", assetId: opened.source.contentId });
  rig = addRigJoint(rig, { id: "root", parent: null });
  rig = addRigJoint(rig, { id: "body", parent: "root", rest: { translation: [0, 0, 1] } });
  rig = addRigJoint(rig, { id: "ornament", parent: "root", rest: { translation: [3, 0, 0] } });
  const bound = await host.bindRig(opened.handle, rig, { strategy: "nearest-segment" });
  rig = attachRigSkin(rig, bound.skin, bound.bind);
  return { host, opened, rig, bound };
}

test("asset host exposes bounded selection, preview, commit and diagnostic operations", async () => {
  const { host, opened, rig, bound } = await setup();
  try {
    const selection = await host.selectWeightVertices(opened.handle, [0, 1]);
    assert.equal(host.describeWeightSelection(opened.handle, selection.id).vertices, 2);
    const preview = await host.previewWeightEdit(
      opened.handle,
      rig,
      bound.weightSetId,
      selection.id,
      { operation: "replace", jointIndex: 2, strength: 0.8 },
    );
    const buffers = host.readWeightPreview(opened.handle, preview.id);
    assert.ok(buffers.weights instanceof Float32Array);
    assert.equal(host.weightEditEvidence(opened.handle).previews, 1);
    const committed = host.commitWeightPreview(opened.handle, preview.id);
    assert.equal(committed.weightSetId, preview.candidateId);
    assert.equal(host.weightEditEvidence(opened.handle).previews, 0);
    assert.equal(host.describeWeightArtifact(opened.handle, committed.weightSetId).baseWeightSetId, bound.weightSetId);
    const diagnostics = await host.diagnoseWeights(opened.handle, rig, committed.weightSetId, { threshold: 0.1 });
    assert.equal(typeof diagnostics.diagnostics.maximumAdjacencyGradient, "number");
  } finally {
    host.destroy();
  }
});

test("discard and asset release zero private selection, preview and derived artifact arrays", async () => {
  const { host, opened, rig, bound } = await setup();
  const selection = await host.selectWeightVertices(opened.handle, [0, 1]);
  const record = host.record(opened.handle);
  const selectionBuffer = record.weightEditor.selectionStore.record(selection.id).vertices;
  const preview = await host.previewWeightEdit(
    opened.handle,
    rig,
    bound.weightSetId,
    selection.id,
    { operation: "add", jointIndex: 2, strength: 0.5 },
  );
  const previewRecord = record.weightEditor.previewRecord(preview.id);
  const previewBuffers = [previewRecord.jointIndices, previewRecord.weights, previewRecord.selectedVertices];
  assert.equal(host.discardWeightPreview(opened.handle, preview.id), true);
  for (const buffer of previewBuffers) assert.ok([...buffer].every((entry) => entry === 0));

  const second = await host.previewWeightEdit(
    opened.handle,
    rig,
    bound.weightSetId,
    selection.id,
    { operation: "rigid", jointIndex: 2 },
  );
  const committed = host.commitWeightPreview(opened.handle, second.id);
  const artifact = record.weightStore.weights.get(committed.weightSetId);
  const retainedArtifact = [artifact.jointIndices, artifact.weights];
  assert.equal(host.release(opened.handle), true);
  assert.ok([...selectionBuffer].every((entry) => entry === 0));
  for (const buffer of retainedArtifact) assert.ok([...buffer].every((entry) => entry === 0));
  host.destroy();
});
