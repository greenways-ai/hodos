import assert from "node:assert/strict";
import test from "node:test";
import { createRiggingSession } from "@greenways/hodos-world-model/rigging";
import { createLocalRiggingAssetHost } from "../src/rigging-asset-host.js";
import { parseGlbContainer } from "../src/rigging-glb-preflight.js";
import {
  buildRiggingSurfaceIndex,
  destroyRiggingSurfaceIndex,
  raycastRiggingSurface,
  surfaceIndexEvidence,
} from "../src/rigging-surface-index.js";
import {
  buildGlb,
  createStylizedUnriggedGlb,
} from "./fixtures/stylized-unrigged-glb.js";

function close(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

function closePoint(actual, expected, tolerance = 1e-6) {
  assert.equal(actual.length, expected.length);
  actual.forEach((entry, index) => close(entry, expected[index], tolerance));
}

function writeFloat32(values) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return bytes;
}

function align4(value) {
  return (value + 3) & ~3;
}

function triangleModeFixture() {
  const strip = writeFloat32([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
    1, 1, 0,
  ]);
  const fan = writeFloat32([
    0, 0, 0,
    1, 0, 0,
    1, 1, 0,
    0, 1, 0,
  ]);
  const fanOffset = align4(strip.byteLength);
  const binary = new Uint8Array(fanOffset + fan.byteLength);
  binary.set(strip, 0);
  binary.set(fan, fanOffset);
  return buildGlb({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { mesh: 0 },
      { mesh: 1, translation: [2, 0, 0] },
    ],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0 }, mode: 5 }] },
      { primitives: [{ attributes: { POSITION: 1 }, mode: 6 }] },
    ],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: strip.byteLength },
      { buffer: 0, byteOffset: fanOffset, byteLength: fan.byteLength },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: "VEC3" },
      { bufferView: 1, componentType: 5126, count: 4, type: "VEC3" },
    ],
  }, binary);
}

async function openFixture(options = {}) {
  const host = createLocalRiggingAssetHost({ id: `surface-${Math.random().toString(36).slice(2)}`, ...options });
  const opened = await host.open(createRiggingSession({ id: "session:surface" }), createStylizedUnriggedGlb());
  assert.equal(opened.ok, true);
  return { host, opened };
}

test("host lazily builds a bounded triangle index and returns the nearest transformed hit", async () => {
  const { host, opened } = await openFixture();
  try {
    const evidence = await host.prepareSurface(opened.handle, { yieldControl: async () => {} });
    assert.equal(evidence.status, "ready");
    assert.equal(evidence.triangles, 3);
    assert.ok(evidence.bvhNodes >= 1);
    assert.equal(JSON.stringify(evidence).includes("Float32Array"), false);

    const body = host.raycastSurface(opened.handle, {
      origin: [0, 0.25, 5],
      direction: [0, 0, -2],
    }, { offset: 0.1 });
    assert.equal(body.ok, true);
    assert.equal(body.hit.nodeIndex, 0);
    assert.equal(body.hit.meshIndex, 0);
    assert.equal(body.hit.primitiveIndex, 0);
    assert.equal(body.hit.triangleIndex, 1);
    assert.equal(body.hit.backFacing, true);
    close(body.hit.distance, 3);
    closePoint(body.hit.point, [0, 0.25, 2.1]);
    closePoint(body.hit.normal, [0, 0, 1]);

    const ornament = host.raycastSurface(opened.handle, {
      origin: [3.25, 0.25, 2],
      direction: [0, 0, -1],
    });
    assert.equal(ornament.hit.nodeIndex, 1);
    assert.equal(ornament.hit.meshIndex, 1);
    closePoint(ornament.hit.point, [3.25, 0.25, 0]);
  } finally {
    host.destroy();
  }
});

test("front, back and double-sided policies preserve deterministic winding behavior", async () => {
  const { host, opened } = await openFixture();
  try {
    await host.prepareSurface(opened.handle, { yieldControl: async () => {} });
    const fromFront = { origin: [0, 0.25, -1], direction: [0, 0, 1] };
    const front = host.raycastSurface(opened.handle, fromFront, { backface: "front" });
    assert.ok(front.hit);
    closePoint(front.hit.point, [0, 0.25, 0]);
    assert.equal(front.hit.backFacing, false);

    const rejectedBack = host.raycastSurface(opened.handle, fromFront, { backface: "back" });
    assert.equal(rejectedBack.hit, null);

    const fromBack = { origin: [0, 0.25, 5], direction: [0, 0, -1] };
    assert.equal(host.raycastSurface(opened.handle, fromBack, { backface: "front" }).hit, null);
    assert.ok(host.raycastSurface(opened.handle, fromBack, { backface: "back" }).hit);
    assert.ok(host.raycastSurface(opened.handle, fromBack, { backface: "double" }).hit);
  } finally {
    host.destroy();
  }
});

test("non-indexed triangle strips and fans are indexed in transformed scene instances", async () => {
  const parsed = parseGlbContainer(triangleModeFixture());
  const index = await buildRiggingSurfaceIndex(parsed, { yieldControl: async () => {}, leafSize: 2 });
  try {
    assert.equal(surfaceIndexEvidence(index).triangles, 4);
    const strip = raycastRiggingSurface(index, { origin: [0.75, 0.75, 2], direction: [0, 0, -1] });
    assert.equal(strip.hit.nodeIndex, 0);
    assert.equal(strip.hit.meshIndex, 0);
    const fan = raycastRiggingSurface(index, { origin: [2.25, 0.75, 2], direction: [0, 0, -1] });
    assert.equal(fan.hit.nodeIndex, 1);
    assert.equal(fan.hit.meshIndex, 1);
    closePoint(fan.hit.point, [2.25, 0.75, 0]);
  } finally {
    destroyRiggingSurfaceIndex(index);
  }
});

test("surface construction limits fail closed while preserving the accepted asset", async () => {
  const { host, opened } = await openFixture({ surface: { maximumTriangles: 2 } });
  try {
    const evidence = await host.prepareSurface(opened.handle, { yieldControl: async () => {} });
    assert.equal(evidence.status, "unsupported");
    assert.equal(evidence.error.code, "rig/surface-triangle-limit");
    assert.equal(host.has(opened.handle), true);
    const result = host.raycastSurface(opened.handle, { origin: [0, 0, 5], direction: [0, 0, -1] });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "rig/surface-triangle-limit");
  } finally {
    host.destroy();
  }
});

test("ray traversal limits return bounded capability failures rather than partial hits", async () => {
  const { host, opened } = await openFixture();
  try {
    await host.prepareSurface(opened.handle, { yieldControl: async () => {} });
    const result = host.raycastSurface(opened.handle, {
      origin: [0, 0.25, 5],
      direction: [0, 0, -1],
    }, { maximumRayTriangles: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "rig/surface-ray-triangle-limit");
  } finally {
    host.destroy();
  }
});

test("release and explicit destruction zero private surface buffers", async () => {
  const parsed = parseGlbContainer(createStylizedUnriggedGlb());
  const index = await buildRiggingSurfaceIndex(parsed, { yieldControl: async () => {} });
  assert.ok(index.positions.some((entry) => entry !== 0));
  assert.equal(destroyRiggingSurfaceIndex(index), true);
  assert.equal(index.positions.every((entry) => entry === 0), true);
  assert.equal(surfaceIndexEvidence(index).status, "destroyed");
  assert.throws(() => raycastRiggingSurface(index, { origin: [0, 0, 1], direction: [0, 0, -1] }), /destroyed/);
  assert.equal(destroyRiggingSurfaceIndex(index), false);

  const { host, opened } = await openFixture();
  await host.prepareSurface(opened.handle, { yieldControl: async () => {} });
  assert.equal(host.release(opened.handle), true);
  assert.throws(() => host.raycastSurface(opened.handle, { origin: [0, 0, 1], direction: [0, 0, -1] }), /Unknown local rigging asset handle/);
  host.destroy();
});
