import assert from "node:assert/strict";
import test from "node:test";
import {
  createRigWeightHeatmapSample,
  destroyRigWeightHeatmapSample,
  rigJointWeightAtVertex,
  rigWeightHeatmapColor,
} from "../src/rigging-weight-heatmap.js";

test("heat-map sampling derives deterministic active-joint values", () => {
  const positions = new Float32Array([
    0, 0, 0,
    1, 0, 0,
    2, 0, 0,
  ]);
  const joints = new Uint16Array([
    0, 1, 0, 0,
    1, 0, 0, 0,
    1, 2, 0, 0,
  ]);
  const weights = new Float32Array([
    0.75, 0.25, 0, 0,
    1, 0, 0, 0,
    0.5, 0.5, 0, 0,
  ]);
  assert.equal(rigJointWeightAtVertex(joints, weights, 0, 4, 1), 0.25);
  const sample = createRigWeightHeatmapSample({
    artifactId: "weights:sha256:demo",
    positions,
    jointIndices: joints,
    weights,
    vertexCount: 3,
    maxInfluences: 4,
    jointIndex: 1,
    maximumPoints: 3,
  });
  assert.deepEqual([...sample.vertices], [0, 1, 2]);
  assert.deepEqual([...sample.values], [0.25, 1, 0.5]);
  assert.equal(sample.evidence.maximumWeight, 1);
  assert.equal(JSON.stringify(sample.evidence).includes("Float32Array"), false);
  const retained = [sample.positions, sample.values, sample.vertices];
  assert.equal(destroyRigWeightHeatmapSample(sample), true);
  for (const array of retained) assert.ok([...array].every((entry) => entry === 0));
});

test("sampling remains bounded and supports explicit selections", () => {
  const positions = new Float32Array(30);
  const joints = new Uint16Array(40);
  const weights = new Float32Array(40);
  for (let vertex = 0; vertex < 10; vertex += 1) {
    positions[vertex * 3] = vertex;
    joints[vertex * 4] = 2;
    weights[vertex * 4] = 1;
  }
  const sample = createRigWeightHeatmapSample({
    positions,
    jointIndices: joints,
    weights,
    vertexCount: 10,
    maxInfluences: 4,
    jointIndex: 2,
    selection: new Uint32Array([1, 3, 5, 7, 9]),
    maximumPoints: 3,
  });
  assert.deepEqual([...sample.vertices], [1, 5, 9]);
  assert.equal(sample.count, 3);
  assert.equal(sample.evidence.truncated, true);
});

test("heat-map colours are stable and weight-sensitive", () => {
  assert.notEqual(rigWeightHeatmapColor(0), rigWeightHeatmapColor(1));
  assert.match(rigWeightHeatmapColor(0.5), /^rgba\(/);
});
