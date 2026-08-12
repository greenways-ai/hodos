import assert from "node:assert/strict";
import test from "node:test";
import {
  GLB_PREFLIGHT_PROVIDER_ID,
  GLB_PREFLIGHT_PROVIDER_VERSION,
  GlbPreflightError,
  analyzeLocalGlb,
  parseGlbContainer,
  preflightLocalGlb,
  sha256ContentId,
} from "@greenways/hodos-renderer-playcanvas/rigging-preflight";
import {
  buildGlb,
  createNonManifoldGlb,
  createStylizedUnriggedGlb,
} from "./fixtures/stylized-unrigged-glb.js";

const FIXTURE_ID = "sha256:30537e076973248245843569058fd0d70181ae868046dccce0f106c7ff58a015";

test("local GLB fixture produces deterministic bounded preflight evidence", async () => {
  const bytes = createStylizedUnriggedGlb();
  const first = await analyzeLocalGlb(bytes);
  const second = await analyzeLocalGlb(bytes);
  assert.equal(first.contentId, FIXTURE_ID);
  assert.equal(await sha256ContentId(bytes), FIXTURE_ID);
  assert.deepEqual(first.preflight, second.preflight);
  assert.equal(first.preflight.provider.id, GLB_PREFLIGHT_PROVIDER_ID);
  assert.equal(first.preflight.provider.version, GLB_PREFLIGHT_PROVIDER_VERSION);
  assert.equal(first.preflight.format.byteLength, bytes.byteLength);
  assert.equal(first.preflight.inventory.scenes.count, 1);
  assert.equal(first.preflight.inventory.nodes.count, 2);
  assert.equal(first.preflight.inventory.meshes.count, 2);
  assert.equal(first.preflight.inventory.meshes.instances, 2);
  assert.equal(first.preflight.inventory.meshes.primitives, 2);
  assert.equal(first.preflight.inventory.materials.referenced, 2);
  assert.equal(first.preflight.inventory.skins.count, 0);
  assert.equal(first.preflight.inventory.animations.count, 0);
  assert.deepEqual(first.preflight.geometry, {
    vertices: 9,
    indices: 9,
    triangles: 3,
    lines: 0,
    points: 0,
    connectedComponents: 3,
    disconnectedPrimitives: 1,
    topologyPrimitivesChecked: 2,
    topologyPrimitivesSkipped: 0,
    nonManifoldEdgeHints: 0,
    missingNormalPrimitives: 1,
    malformedSkinPrimitives: 0,
    bounds: {
      min: [-1, 0, 0],
      max: [4, 1, 2],
      center: [1.5, 0.5, 1],
      size: [5, 1, 2],
    },
    primitiveModes: [{ mode: 4, label: "TRIANGLES", count: 2 }],
  });
  assert.deepEqual(first.preflight.transforms, {
    matrixNodes: 0,
    trsNodes: 2,
    nonIdentityNodes: 1,
    negativeScaleNodes: 0,
    extremeScaleNodes: 0,
  });
  assert.equal(first.preflight.summary.status, "warn");
  assert.deepEqual(first.preflight.issues.map(({ code }) => code), [
    "mesh/disconnected-components",
    "normal/missing",
  ]);
  assert.equal(JSON.stringify(first.preflight).includes("bufferView"), false);
  assert.equal(JSON.stringify(first.preflight).includes("Float32Array"), false);
});

test("malformed existing skins are identified without overwriting source state", async () => {
  const report = await preflightLocalGlb(createStylizedUnriggedGlb({ malformedSkin: true }));
  assert.equal(report.features.hasSkins, true);
  assert.equal(report.inventory.skins.count, 1);
  assert.equal(report.inventory.skins.joints, 1);
  assert.equal(report.geometry.malformedSkinPrimitives, 1);
  assert.equal(report.summary.status, "blocked");
  assert.ok(report.issues.some(({ code, severity }) => code === "skin/existing" && severity === "info"));
  assert.ok(report.issues.some(({ code, severity }) => code === "skin/attributes-missing" && severity === "error"));
});

test("indexed topology reports non-manifold edge hints", async () => {
  const report = await preflightLocalGlb(createNonManifoldGlb());
  assert.equal(report.geometry.topologyPrimitivesChecked, 1);
  assert.equal(report.geometry.nonManifoldEdgeHints, 1);
  assert.ok(report.issues.some(({ code }) => code === "mesh/non-manifold-hint"));
});


test("compressed geometry is identified as a provider capability blocker while retaining declared bounds", async () => {
  const bytes = buildGlb({
    asset: { version: "2.0" },
    extensionsUsed: ["KHR_draco_mesh_compression"],
    extensionsRequired: ["KHR_draco_mesh_compression"],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0 },
        indices: 1,
        mode: 4,
        extensions: { KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: 0 } } },
      }],
    }],
    buffers: [{ byteLength: 4 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4 }],
    accessors: [
      { componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [2, 1, 0] },
      { componentType: 5123, count: 3, type: "SCALAR" },
    ],
  }, new Uint8Array(4));
  const report = await preflightLocalGlb(bytes);
  assert.equal(report.summary.status, "blocked");
  assert.deepEqual(report.geometry.bounds, {
    min: [0, 0, 0],
    max: [2, 1, 0],
    center: [1, 0.5, 0],
    size: [2, 1, 0],
  });
  assert.equal(report.geometry.topologyPrimitivesSkipped, 1);
  assert.ok(report.issues.some(({ code }) => code === "compression/draco-required"));
  assert.ok(report.issues.some(({ code }) => code === "compression/draco"));
});

test("container parsing rejects truncated, mismatched, and non-GLB bytes with structured errors", () => {
  assert.throws(() => parseGlbContainer(new Uint8Array(4)), (error) => {
    assert.ok(error instanceof GlbPreflightError);
    assert.equal(error.code, "glb/too-small");
    return true;
  });

  const bytes = createStylizedUnriggedGlb();
  const wrongMagic = new Uint8Array(bytes);
  new DataView(wrongMagic.buffer).setUint32(0, 0, true);
  assert.throws(() => parseGlbContainer(wrongMagic), (error) => error.code === "glb/magic");

  const wrongLength = new Uint8Array(bytes);
  new DataView(wrongLength.buffer).setUint32(8, wrongLength.byteLength - 4, true);
  assert.throws(() => parseGlbContainer(wrongLength), (error) => error.code === "glb/length");
});

test("external geometry buffers are reported as blockers rather than fetched", async () => {
  const bytes = buildGlb({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
    buffers: [{ byteLength: 36, uri: "https://example.invalid/model.bin" }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
  });
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => {
    fetchCalls += 1;
    throw new Error("Network access is forbidden in local preflight");
  };
  try {
    const report = await preflightLocalGlb(bytes);
    assert.equal(fetchCalls, 0);
    assert.equal(report.features.hasExternalResources, true);
    assert.equal(report.summary.status, "blocked");
    assert.ok(report.issues.some(({ code }) => code === "buffer/external-uri"));
    assert.ok(report.issues.some(({ code }) => code === "buffer/external"));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("inventory and issue projection remain bounded for large source documents", async () => {
  const nodes = Array.from({ length: 90 }, (_, index) => ({ name: `Node ${index}` }));
  const bytes = buildGlb({
    asset: { version: "2.0" },
    scenes: [{ nodes: nodes.map((_, index) => index) }],
    nodes,
  });
  const report = await preflightLocalGlb(bytes, { maximumInventoryItems: 8, maximumIssues: 4 });
  assert.equal(report.inventory.nodes.count, 90);
  assert.equal(report.inventory.nodes.items.length, 8);
  assert.equal(report.inventory.nodes.omitted, 82);
  assert.ok(report.issues.length <= 4);
});
