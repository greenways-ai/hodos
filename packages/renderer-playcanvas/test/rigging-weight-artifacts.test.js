import assert from "node:assert/strict";
import test from "node:test";
import {
  addRigJoint,
  attachRigSkin,
  createRigDocument,
} from "@greenways/hodos-world-model/rigging";
import { createRiggingSession } from "@greenways/hodos-world-model/rigging";
import { createLocalRiggingAssetHost } from "../src/rigging-asset-host.js";
import { createStylizedUnriggedGlb } from "./fixtures/stylized-unrigged-glb.js";

async function setup(id = "weights") {
  const host = createLocalRiggingAssetHost({ id });
  const opened = await host.open(createRiggingSession({ id: `session:${id}` }), createStylizedUnriggedGlb());
  let rig = createRigDocument({ id: `rig:${id}`, assetId: opened.source.contentId });
  rig = addRigJoint(rig, { id: "root", parent: null, rest: { translation: [0, 0, 0] } });
  rig = addRigJoint(rig, { id: "body", parent: "root", rest: { translation: [0, 0, 1] } });
  rig = addRigJoint(rig, { id: "ornament", parent: "root", rest: { translation: [3, 0, 0] } });
  return { host, opened, rig };
}

test("local asset host produces deterministic content-addressed nearest weights and bind matrices", async () => {
  const { host, opened, rig } = await setup("nearest");
  try {
    const first = await host.bindRig(opened.handle, rig, { strategy: "nearest-segment" });
    const second = await host.bindRig(opened.handle, rig, { strategy: "nearest-segment" });
    assert.equal(first.weightSetId, second.weightSetId);
    assert.equal(first.inverseMatricesId, second.inverseMatricesId);
    assert.match(first.weightSetId, /^weights:sha256:[0-9a-f]{64}$/);
    assert.match(first.inverseMatricesId, /^bind:sha256:[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(first).includes("Float32Array"), false);
    const weight = host.readWeightArtifact(opened.handle, first.weightSetId);
    assert.equal(weight.weights.length, 9 * 4);
    for (let vertex = 0; vertex < 9; vertex += 1) {
      const sum = [...weight.weights.slice(vertex * 4, vertex * 4 + 4)].reduce((total, entry) => total + entry, 0);
      assert.ok(Math.abs(sum - 1) < 1e-5);
    }
    const bind = host.readBindArtifact(opened.handle, first.inverseMatricesId);
    assert.equal(bind.length, rig.joints.length * 16);
    const attached = attachRigSkin(rig, first.skin, first.bind);
    assert.equal(attached.skin.weightSetId, first.weightSetId);
    assert.equal(attached.bind.inverseMatricesId, first.inverseMatricesId);
    assert.equal(host.weightEvidence(opened.handle).weightArtifacts, 1);
    assert.equal(host.weightEvidence(opened.handle).bindArtifacts, 1);
  } finally {
    host.destroy();
  }
});

test("separate local hosts produce the same accepted artifact identities", async () => {
  const left = await setup("same");
  const right = await setup("same");
  try {
    const first = await left.host.bindRig(left.opened.handle, left.rig, { strategy: "nearest-segment" });
    const second = await right.host.bindRig(right.opened.handle, right.rig, { strategy: "nearest-segment" });
    assert.equal(first.weightSetId, second.weightSetId);
    assert.equal(first.inverseMatricesId, second.inverseMatricesId);
  } finally {
    left.host.destroy();
    right.host.destroy();
  }
});

test("rigid component binding assigns one active joint per disconnected component", async () => {
  const { host, opened, rig } = await setup("rigid");
  try {
    const bound = await host.bindRig(opened.handle, rig, { strategy: "rigid-component" });
    const artifact = host.readWeightArtifact(opened.handle, bound.weightSetId);
    assert.ok(artifact.componentAssignments instanceof Uint16Array);
    assert.equal(artifact.componentAssignments.length, 3);
    for (let vertex = 0; vertex < 9; vertex += 1) {
      assert.equal(artifact.weights[vertex * 4], 1);
      assert.deepEqual([...artifact.weights.slice(vertex * 4 + 1, vertex * 4 + 4)], [0, 0, 0]);
    }
    assert.equal(bound.evidence.diagnostics.unweightedVertices, 0);
  } finally {
    host.destroy();
  }
});

test("binding rejects a mismatched rig without discarding the accepted local asset", async () => {
  const { host, opened, rig } = await setup("mismatch");
  try {
    await assert.rejects(
      () => host.bindRig(opened.handle, { ...rig, assetId: "sha256:other" }),
      /does not match/,
    );
    assert.equal(host.has(opened.handle), true);
    assert.equal(host.weightEvidence(opened.handle).weightArtifacts, 0);
  } finally {
    host.destroy();
  }
});

test("releasing an asset zeroes private geometry and artifact buffers", async () => {
  const { host, opened, rig } = await setup("release");
  const bound = await host.bindRig(opened.handle, rig, { strategy: "rigid-component" });
  const store = host.record(opened.handle).weightStore;
  const geometryBuffers = [
    store.geometry.positions,
    store.geometry.metadata,
    store.geometry.triangles,
    store.geometry.adjacencyOffsets,
    store.geometry.adjacency,
    store.geometry.componentIds,
  ];
  const weightArtifact = store.weights.get(bound.weightSetId);
  const bindArtifact = store.binds.get(bound.inverseMatricesId);
  const retained = [
    ...geometryBuffers,
    weightArtifact.jointIndices,
    weightArtifact.weights,
    weightArtifact.componentAssignments,
    bindArtifact.inverseBindMatrices,
  ];
  assert.equal(host.release(opened.handle), true);
  for (const buffer of retained) assert.ok([...buffer].every((entry) => entry === 0));
  host.destroy();
});
