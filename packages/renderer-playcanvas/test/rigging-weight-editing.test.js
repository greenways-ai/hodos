import assert from "node:assert/strict";
import test from "node:test";
import {
  addRigJoint,
  attachRigSkin,
  createRigDocument,
  createRiggingSession,
} from "@greenways/hodos-world-model/rigging";
import { createLocalRiggingAssetHost } from "../src/rigging-asset-host.js";
import { RiggingWeightEditingStore } from "../src/rigging-weight-editing.js";
import { createStylizedUnriggedGlb } from "./fixtures/stylized-unrigged-glb.js";

async function setup(id = "edit") {
  const host = createLocalRiggingAssetHost({ id });
  const opened = await host.open(createRiggingSession({ id: `session:${id}` }), createStylizedUnriggedGlb());
  let rig = createRigDocument({ id: `rig:${id}`, assetId: opened.source.contentId });
  rig = addRigJoint(rig, { id: "root", parent: null, rest: { translation: [0, 0, 0] } });
  rig = addRigJoint(rig, { id: "body", parent: "root", rest: { translation: [0, 0, 1] } });
  rig = addRigJoint(rig, { id: "ornament", parent: "root", rest: { translation: [3, 0, 0] } });
  const bound = await host.bindRig(opened.handle, rig, { strategy: "nearest-segment" });
  rig = attachRigSkin(rig, bound.skin, bound.bind);
  const editing = new RiggingWeightEditingStore({
    artifactStore: host.record(opened.handle).weightStore,
    id: `editing:${id}`,
  });
  return { host, opened, rig, bound, editing };
}

test("host-local previews leave the accepted base artifact unchanged until commit", async () => {
  const { host, opened, rig, bound, editing } = await setup("preview");
  try {
    const selected = await editing.selectVertices([0]);
    const baseBefore = host.readWeightArtifact(opened.handle, bound.weightSetId);
    const preview = await editing.preview(rig, bound.weightSetId, selected.id, {
      operation: "add",
      jointIndex: 2,
      strength: 1,
    });
    assert.match(preview.candidateId, /^weights:sha256:[0-9a-f]{64}$/);
    assert.equal(editing.evidence().previews, 1);
    const baseAfter = editing.artifactStore.readWeight(bound.weightSetId);
    assert.deepEqual([...baseAfter.jointIndices], [...baseBefore.jointIndices]);
    assert.deepEqual([...baseAfter.weights], [...baseBefore.weights]);
    const committed = editing.commitPreview(preview.id);
    assert.equal(committed.weightSetId, preview.candidateId);
    assert.equal(editing.evidence().previews, 0);
    assert.equal(editing.artifactStore.weights.size, 2);
  } finally {
    editing.destroy();
    host.destroy();
  }
});

test("identical base, selection content, edit and rig revision produce the same derived identity", async () => {
  const { host, rig, bound, editing } = await setup("deterministic");
  try {
    const left = await editing.selectVertices([0, 1]);
    const right = await editing.selectVertices([1, 0, 1]);
    const edit = { operation: "replace", jointIndex: 2, strength: 0.75 };
    const first = await editing.edit(rig, bound.weightSetId, left.id, edit);
    const second = await editing.edit(rig, bound.weightSetId, right.id, edit);
    assert.equal(first.weightSetId, second.weightSetId);
    assert.equal(editing.artifactStore.weights.size, 2);
    assert.equal(first.bind.inverseMatricesId, rig.bind.inverseMatricesId);
  } finally {
    editing.destroy();
    host.destroy();
  }
});

test("component flood, smoothing and diagnostics use host-owned topology", async () => {
  const { host, rig, bound, editing } = await setup("topology");
  try {
    const seed = await editing.selectVertices([0]);
    const flooded = await editing.edit(rig, bound.weightSetId, seed.id, {
      operation: "flood",
      jointIndex: 2,
    });
    assert.ok(flooded.evidence.affectedVertices >= 3);
    const component = await editing.selectComponents({ seedVertices: [0] });
    const smoothed = await editing.edit(rig, flooded.weightSetId, component.id, {
      operation: "smooth",
      strength: 0.5,
      iterations: 2,
    });
    assert.match(smoothed.weightSetId, /^weights:sha256:/);
    const diagnostics = await editing.diagnose(rig, smoothed.weightSetId, { threshold: 0.1 });
    assert.equal(typeof diagnostics.diagnostics.abruptGradientEdges, "number");
    if (diagnostics.problemSelectionId) {
      assert.ok(editing.describeSelection(diagnostics.problemSelectionId).vertices > 0);
    }
  } finally {
    editing.destroy();
    host.destroy();
  }
});


test("editing rejects inverse-bind and influence-limit mismatches before preview allocation", async () => {
  const { host, rig, bound, editing } = await setup("mismatch");
  try {
    const selection = await editing.selectVertices([0]);
    const wrongBind = {
      ...rig,
      bind: { inverseMatricesId: "bind:sha256:not-the-base" },
    };
    await assert.rejects(
      editing.preview(wrongBind, bound.weightSetId, selection.id, { operation: "add", jointIndex: 2 }),
      /same inverse bind artifact/,
    );
    const wrongInfluences = {
      ...rig,
      skin: { ...rig.skin, maxInfluences: rig.skin.maxInfluences === 4 ? 2 : 4 },
    };
    await assert.rejects(
      editing.preview(wrongInfluences, bound.weightSetId, selection.id, { operation: "add", jointIndex: 2 }),
      /different influence limits/,
    );
    assert.equal(editing.evidence().previews, 0);
  } finally {
    editing.destroy();
    host.destroy();
  }
});

test("preview and selection buffers are zeroed when editing is destroyed", async () => {
  const { host, rig, bound, editing } = await setup("destroy");
  const selection = await editing.selectVertices([0, 1]);
  const selectionBuffer = editing.selectionStore.record(selection.id).vertices;
  const preview = await editing.preview(rig, bound.weightSetId, selection.id, {
    operation: "add",
    jointIndex: 2,
    strength: 0.5,
  });
  const previewRecord = editing.previewRecord(preview.id);
  const retained = [previewRecord.jointIndices, previewRecord.weights, previewRecord.selectedVertices];
  editing.destroy();
  assert.ok([...selectionBuffer].every((entry) => entry === 0));
  for (const buffer of retained) assert.ok([...buffer].every((entry) => entry === 0));
  host.destroy();
});
