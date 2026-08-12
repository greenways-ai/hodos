import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRigIntent,
  buildRigWeightAttachmentIntent,
  createRigDocument,
} from "../src/rigging-model.js";
import {
  applyRigWeightEdit,
  diagnoseRigWeightAdjacency,
} from "../src/rigging-weight-edit.js";

function document() {
  return createRigDocument({
    id: "rig:edit",
    assetId: "sha256:edit",
    skin: { maxInfluences: 2 },
    joints: [
      { id: "root", parent: null },
      { id: "left", parent: "root", rest: { translation: [-1, 0, 0] } },
      { id: "right", parent: "root", rest: { translation: [1, 0, 0] } },
    ],
  });
}

function weights() {
  return {
    jointIndices: new Uint16Array([
      1, 0,
      1, 2,
      2, 0,
      2, 0,
    ]),
    weights: new Float32Array([
      1, 0,
      0.5, 0.5,
      1, 0,
      1, 0,
    ]),
    adjacencyOffsets: new Uint32Array([0, 1, 3, 5, 6]),
    adjacency: new Uint32Array([1, 0, 2, 1, 3, 2]),
    componentIds: new Uint32Array([0, 0, 0, 1]),
  };
}

test("add, subtract, replace, prune and normalize edits are deterministic and immutable", () => {
  const input = weights();
  const originalIndices = input.jointIndices.slice();
  const originalWeights = input.weights.slice();
  const added = applyRigWeightEdit({
    document: document(),
    ...input,
    selectedVertices: [0],
    edit: { operation: "add", jointIndex: 2, strength: 1 },
  });
  assert.deepEqual([...input.jointIndices], [...originalIndices]);
  assert.deepEqual([...input.weights], [...originalWeights]);
  assert.deepEqual([...added.jointIndices.slice(0, 2)], [1, 2]);
  assert.ok(Math.abs(added.weights[0] - 0.5) < 1e-6);
  assert.ok(Math.abs(added.weights[1] - 0.5) < 1e-6);

  const subtracted = applyRigWeightEdit({
    document: document(),
    ...input,
    selectedVertices: [0],
    edit: { operation: "subtract", jointIndex: 1, strength: 1 },
  });
  assert.equal(subtracted.summary.unweightedVertices, 1);
  assert.equal(subtracted.summary.intentionallyUnweighted, true);

  const replaced = applyRigWeightEdit({
    document: document(),
    ...input,
    selectedVertices: [1],
    edit: { operation: "replace", jointIndex: 1, strength: 0.75 },
  });
  assert.deepEqual([...replaced.jointIndices.slice(2, 4)], [1, 2]);
  assert.ok(Math.abs(replaced.weights[2] - 0.75) < 1e-6);
  assert.ok(Math.abs(replaced.weights[3] - 0.25) < 1e-6);

  const pruned = applyRigWeightEdit({
    document: document(),
    jointIndices: replaced.jointIndices,
    weights: replaced.weights,
    adjacencyOffsets: input.adjacencyOffsets,
    adjacency: input.adjacency,
    componentIds: input.componentIds,
    selectedVertices: [1],
    edit: { operation: "prune", threshold: 0.3 },
  });
  assert.deepEqual([...pruned.weights.slice(2, 4)], [1, 0]);

  const repeated = applyRigWeightEdit({
    document: document(),
    ...input,
    selectedVertices: [0],
    edit: { operation: "add", jointIndex: 2, strength: 1 },
  });
  assert.deepEqual([...repeated.jointIndices], [...added.jointIndices]);
  assert.deepEqual([...repeated.weights], [...added.weights]);
});

test("smooth uses CSR adjacency and obeys the neighbor visit bound", () => {
  const input = weights();
  const smoothed = applyRigWeightEdit({
    document: document(),
    ...input,
    selectedVertices: [1],
    edit: { operation: "smooth", strength: 1, iterations: 1 },
  });
  assert.deepEqual([...smoothed.jointIndices.slice(2, 4)], [1, 2]);
  assert.ok(Math.abs(smoothed.weights[2] - 0.5) < 1e-6);
  assert.ok(Math.abs(smoothed.weights[3] - 0.5) < 1e-6);
  assert.equal(smoothed.summary.neighborVisits, 2);
  assert.throws(() => applyRigWeightEdit({
    document: document(),
    ...input,
    selectedVertices: [1],
    edit: { operation: "smooth", strength: 1 },
    maximumNeighborVisits: 1,
  }), /neighbor-visit limit/);
});

test("flood expands only through selected connected components", () => {
  const input = weights();
  const flooded = applyRigWeightEdit({
    document: document(),
    ...input,
    selectedVertices: [0],
    edit: { operation: "flood", jointIndex: 2 },
  });
  assert.deepEqual([...flooded.selectedVertices], [0, 1, 2]);
  for (const vertex of [0, 1, 2]) {
    assert.equal(flooded.jointIndices[vertex * 2], 2);
    assert.equal(flooded.weights[vertex * 2], 1);
  }
  assert.equal(flooded.jointIndices[6], 2);
  assert.equal(flooded.weights[6], 1);
});

test("adjacency diagnostics report abrupt edges through bounded representative vertices", () => {
  const input = weights();
  const diagnostics = diagnoseRigWeightAdjacency({
    ...input,
    vertexCount: 4,
    maxInfluences: 2,
    threshold: 0.4,
  });
  assert.equal(diagnostics.summary.adjacencyEdges, 3);
  assert.equal(diagnostics.summary.abruptGradientEdges, 2);
  assert.ok(diagnostics.summary.maximumAdjacencyGradient >= 0.5);
  assert.deepEqual([...diagnostics.representativeVertices], [0, 1, 2]);
});


test("warned unweighted bases can be repaired incrementally without widening the warning", () => {
  const input = weights();
  const unweighted = applyRigWeightEdit({
    document: document(),
    ...input,
    selectedVertices: [0, 3],
    edit: { operation: "subtract", jointIndex: 1, strength: 1 },
  });
  assert.equal(unweighted.summary.unweightedVertices, 1);
  const repaired = applyRigWeightEdit({
    document: document(),
    jointIndices: unweighted.jointIndices,
    weights: unweighted.weights,
    adjacencyOffsets: input.adjacencyOffsets,
    adjacency: input.adjacency,
    componentIds: input.componentIds,
    selectedVertices: [0],
    edit: { operation: "add", jointIndex: 2, strength: 1 },
  });
  assert.equal(repaired.summary.unweightedVertices, 0);
  assert.equal(repaired.summary.intentionallyUnweighted, false);
});

test("adjacency diagnostics fail closed on malformed shapes and non-contiguous CSR offsets", () => {
  const input = weights();
  assert.throws(() => diagnoseRigWeightAdjacency({
    jointIndices: input.jointIndices.slice(0, 4),
    weights: input.weights,
    vertexCount: 4,
    maxInfluences: 2,
    adjacencyOffsets: input.adjacencyOffsets,
    adjacency: input.adjacency,
  }), /do not match/);
  assert.throws(() => diagnoseRigWeightAdjacency({
    ...input,
    vertexCount: 4,
    maxInfluences: 2,
    adjacencyOffsets: new Uint32Array([0, 2, 1, 5, 6]),
  }), /not contiguous|invalid range/);
});

test("artifact attachment intent keeps undoable portable IDs at the rig boundary", () => {
  const rig = document();
  const intent = buildRigWeightAttachmentIntent(rig, {
    skin: { weightSetId: "weights:sha256:abc", maxInfluences: 2 },
    bind: { inverseMatricesId: "bind:sha256:def" },
  });
  const applied = applyRigIntent(rig, intent);
  assert.equal(applied.ok, true);
  assert.equal(applied.document.skin.weightSetId, "weights:sha256:abc");
  assert.equal(applied.document.bind.inverseMatricesId, "bind:sha256:def");
  assert.equal(rig.skin.weightSetId, null);
});
