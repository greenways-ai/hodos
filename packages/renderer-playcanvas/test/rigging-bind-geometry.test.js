import assert from "node:assert/strict";
import test from "node:test";
import { analyzeLocalGlb } from "../src/rigging-glb-preflight.js";
import {
  bindGeometryEvidence,
  buildRiggingBindGeometry,
  destroyRiggingBindGeometry,
} from "../src/rigging-bind-geometry.js";
import { createStylizedUnriggedGlb } from "./fixtures/stylized-unrigged-glb.js";

async function fixture() {
  const analysis = await analyzeLocalGlb(createStylizedUnriggedGlb());
  return buildRiggingBindGeometry({ document: analysis.document, binaryChunk: analysis.binaryChunk }, {
    yieldControl: async () => {},
  });
}

test("binding geometry preserves source identity while joining disconnected local primitives", async () => {
  const geometry = await fixture();
  try {
    assert.ok(geometry.positions instanceof Float32Array);
    assert.ok(geometry.metadata instanceof Int32Array);
    assert.ok(geometry.triangles instanceof Uint32Array);
    assert.ok(geometry.adjacencyOffsets instanceof Uint32Array);
    assert.ok(geometry.componentIds instanceof Uint32Array);
    assert.equal(geometry.vertexCount, 9);
    assert.equal(geometry.triangleCount, 3);
    assert.equal(geometry.componentCount, 3);
    assert.equal(geometry.primitiveRanges.length, 2);
    assert.deepEqual([...new Set(geometry.componentIds)], [0, 1, 2]);
    assert.deepEqual([...geometry.positions.slice(18, 27)], [3, 0, 0, 4, 0, 0, 3, 1, 0]);
    assert.equal(bindGeometryEvidence(geometry).vertices, 9);
    assert.equal(JSON.stringify(bindGeometryEvidence(geometry)).includes("Float32Array"), false);
  } finally {
    destroyRiggingBindGeometry(geometry);
  }
});

test("binding geometry builds deterministic CSR adjacency", async () => {
  const left = await fixture();
  const right = await fixture();
  try {
    assert.deepEqual([...left.positions], [...right.positions]);
    assert.deepEqual([...left.triangles], [...right.triangles]);
    assert.deepEqual([...left.adjacencyOffsets], [...right.adjacencyOffsets]);
    assert.deepEqual([...left.adjacency], [...right.adjacency]);
    assert.deepEqual([...left.componentIds], [...right.componentIds]);
  } finally {
    destroyRiggingBindGeometry(left);
    destroyRiggingBindGeometry(right);
  }
});

test("binding geometry limits fail closed", async () => {
  const analysis = await analyzeLocalGlb(createStylizedUnriggedGlb());
  await assert.rejects(
    () => buildRiggingBindGeometry({ document: analysis.document, binaryChunk: analysis.binaryChunk }, { maximumVertices: 8 }),
    /vertex limit/,
  );
});

test("binding geometry zeroes every retained typed array on destruction", async () => {
  const geometry = await fixture();
  const retained = [
    geometry.positions,
    geometry.metadata,
    geometry.triangles,
    geometry.adjacencyOffsets,
    geometry.adjacency,
    geometry.componentIds,
  ];
  assert.equal(destroyRiggingBindGeometry(geometry), true);
  assert.equal(destroyRiggingBindGeometry(geometry), false);
  for (const buffer of retained) assert.ok([...buffer].every((entry) => entry === 0));
  assert.equal(bindGeometryEvidence(geometry).status, "destroyed");
});
