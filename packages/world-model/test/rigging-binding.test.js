import assert from "node:assert/strict";
import test from "node:test";
import {
  rigInverseBindMatrices,
  seedRigWeightsByComponents,
} from "../src/rigging-binding.js";
import { createRigDocument } from "../src/rigging-validation.js";

function rig() {
  return createRigDocument({
    id: "rig:binding",
    assetId: "sha256:binding",
    skin: { maxInfluences: 4 },
    joints: [
      { id: "root", parent: null },
      { id: "left", parent: "root", rest: { translation: [-2, 0, 0] } },
      { id: "right", parent: "root", rest: { translation: [2, 0, 0] } },
    ],
  });
}

test("rigid component binding assigns each disconnected component to one nearest joint", () => {
  const result = seedRigWeightsByComponents({
    document: rig(),
    positions: new Float32Array([
      -2, 0, 0, -1.5, 0, 0, -2, 0.5, 0,
       2, 0, 0,  1.5, 0, 0,  2, 0.5, 0,
    ]),
    componentIds: new Uint32Array([0, 0, 0, 1, 1, 1]),
    componentCount: 2,
  });
  assert.equal(result.strategy, "rigid-component");
  assert.deepEqual([...result.componentAssignments], [1, 2]);
  assert.deepEqual([...result.jointIndices].filter((_, index) => index % 4 === 0), [1, 1, 1, 2, 2, 2]);
  assert.deepEqual([...result.weights].filter((_, index) => index % 4 === 0), [1, 1, 1, 1, 1, 1]);
  assert.equal(result.summary.unweightedVertices, 0);
  assert.equal(result.summary.nonNormalizedVertices, 0);
});

test("rigid component binding is deterministic and bounded", () => {
  const input = {
    document: rig(),
    positions: new Float32Array([-2, 0, 0, 2, 0, 0]),
    componentIds: new Uint32Array([0, 1]),
    componentCount: 2,
  };
  assert.deepEqual(
    [...seedRigWeightsByComponents(input).componentAssignments],
    [...seedRigWeightsByComponents(input).componentAssignments],
  );
  assert.throws(() => seedRigWeightsByComponents({ ...input, maximumDistanceEvaluations: 5 }), /bounded limit/);
});

test("inverse bind matrices invert the canonical world rest transforms", () => {
  const document = createRigDocument({
    id: "rig:inverse",
    assetId: "sha256:inverse",
    joints: [
      {
        id: "root",
        parent: null,
        rest: { translation: [3, 4, 5], rotation: [0, 0, 0, 1], scale: [2, 2, 2] },
      },
      {
        id: "child",
        parent: "root",
        rest: { translation: [1, 0, 0] },
      },
    ],
  });
  const matrices = rigInverseBindMatrices(document);
  assert.ok(matrices instanceof Float32Array);
  assert.equal(matrices.length, 32);
  assert.deepEqual([...matrices.slice(0, 16)], [
    0.5, 0, 0, 0,
    0, 0.5, 0, 0,
    0, 0, 0.5, 0,
    -1.5, -2, -2.5, 1,
  ]);
  assert.deepEqual([...matrices.slice(16, 32)], [
    0.5, 0, 0, 0,
    0, 0.5, 0, 0,
    0, 0, 0.5, 0,
    -2.5, -2, -2.5, 1,
  ]);
});
