import assert from "node:assert/strict";
import test from "node:test";
import {
  RIG_PREFLIGHT_SCHEMA,
  RIG_SESSION_SCHEMA,
  RIG_SOURCE_SCHEMA,
  acceptRiggingSource,
  activeRiggingSource,
  createRiggingPreflight,
  createRiggingSession,
  createRiggingSource,
  normalizeRiggingPreflight,
  normalizeRiggingSession,
  recordRiggingOpenFailure,
} from "../src/rigging-preflight.js";

const SOURCE_ID = `sha256:${"a".repeat(64)}`;

function source(handle = "rig-asset:test:1") {
  return createRiggingSource({
    contentId: SOURCE_ID,
    revision: 0,
    fileName: "opal-creature.glb",
    mediaType: "model/gltf-binary",
    byteLength: 1024,
    handle: { type: "rig/source-asset", id: handle, scope: "session" },
  });
}

function preflight(overrides = {}) {
  return createRiggingPreflight({
    sourceId: SOURCE_ID,
    sourceRevision: 0,
    provider: { id: "playcanvas/glb-preflight", version: "0-alpha.1", profile: "default" },
    format: {
      container: "glb",
      version: 2,
      byteLength: 1024,
      jsonChunkBytes: 512,
      binaryChunkBytes: 484,
      generator: "fixture",
    },
    inventory: {
      scenes: { count: 1, items: [{ index: 0, name: "Scene" }], omitted: 0 },
      nodes: { count: 2, roots: 1, items: [{ index: 0, name: "Root" }], omitted: 1 },
      meshes: { count: 1, instances: 1, primitives: 1, items: [{ index: 0, vertices: 3 }], omitted: 0 },
      materials: { count: 1, referenced: 1, items: [{ index: 0, name: "Pearl" }], omitted: 0 },
      skins: { count: 0, joints: 0, items: [], omitted: 0 },
      animations: { count: 0, channels: 0, samplers: 0, items: [], omitted: 0 },
    },
    geometry: {
      vertices: 3,
      indices: 3,
      triangles: 1,
      lines: 0,
      points: 0,
      connectedComponents: 1,
      disconnectedPrimitives: 0,
      topologyPrimitivesChecked: 1,
      topologyPrimitivesSkipped: 0,
      nonManifoldEdgeHints: 0,
      missingNormalPrimitives: 0,
      malformedSkinPrimitives: 0,
      bounds: { min: [0, 0, 0], max: [1, 1, 0] },
      primitiveModes: [{ mode: 4, label: "TRIANGLES", count: 1 }],
    },
    transforms: {
      matrixNodes: 0,
      trsNodes: 2,
      nonIdentityNodes: 0,
      negativeScaleNodes: 0,
      extremeScaleNodes: 0,
    },
    features: {
      hasNormals: true,
      hasTangents: false,
      hasColors: false,
      hasTexcoords: true,
      hasMorphTargets: false,
      hasSkins: false,
      hasAnimations: false,
      hasExternalResources: false,
    },
    issues: [],
    summary: { errors: 0, warnings: 0, info: 0, omittedIssues: 0 },
    ...overrides,
  });
}

test("source, preflight, and session documents are portable and bounded", () => {
  const asset = source();
  const report = preflight();
  const session = createRiggingSession({ id: "rig-session:opal" });
  assert.equal(asset.schema, RIG_SOURCE_SCHEMA);
  assert.equal(report.schema, RIG_PREFLIGHT_SCHEMA);
  assert.equal(session.schema, RIG_SESSION_SCHEMA);
  assert.equal(session.status, "empty");
  assert.equal(report.summary.status, "ready");
  assert.deepEqual(report.geometry.bounds, {
    min: [0, 0, 0],
    max: [1, 1, 0],
    center: [0.5, 0.5, 0],
    size: [1, 1, 0],
  });
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(report.inventory.nodes.items));
});

test("accepting a source advances one session revision and retains exact source identity", () => {
  const accepted = acceptRiggingSource(createRiggingSession({ id: "rig-session:opal" }), {
    source: source(),
    preflight: preflight(),
  });
  assert.equal(accepted.revision, 1);
  assert.equal(accepted.status, "ready");
  assert.equal(accepted.active.source.contentId, SOURCE_ID);
  assert.equal(accepted.active.preflight.sourceId, SOURCE_ID);
  assert.equal(accepted.lastAttempt.status, "succeeded");
  assert.equal(accepted.lastAttempt.sequence, 1);
  assert.equal(activeRiggingSource(accepted).source.handle.id, "rig-asset:test:1");
});

test("a failed replacement attempt preserves the prior active source", () => {
  const accepted = acceptRiggingSource(createRiggingSession({ id: "rig-session:opal" }), {
    source: source(),
    preflight: preflight(),
  });
  const failed = recordRiggingOpenFailure(accepted, {
    fileName: "broken.glb",
    byteLength: 17,
    error: { code: "glb/header", message: "Invalid GLB header", details: { offset: 0 } },
  });
  assert.equal(failed.revision, 2);
  assert.equal(failed.status, "ready");
  assert.equal(failed.active.source.contentId, SOURCE_ID);
  assert.equal(failed.lastAttempt.status, "failed");
  assert.equal(failed.lastAttempt.recoverable, true);
  assert.equal(failed.lastAttempt.error.code, "glb/header");
});

test("a first failed open produces a recoverable structured failure state without fabricating a source", () => {
  const failed = recordRiggingOpenFailure(createRiggingSession({ id: "rig-session:new" }), {
    fileName: "broken.glb",
    byteLength: 4,
    error: { code: "glb/too-small", message: "GLB is shorter than its header" },
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.active, null);
  assert.equal(failed.lastAttempt.recoverable, false);
  assert.equal(failed.lastAttempt.sequence, 1);
});

test("portable boundaries reject mismatched identities, typed arrays, and unbounded inventories", () => {
  assert.throws(() => acceptRiggingSource(createRiggingSession({ id: "rig-session:bad" }), {
    source: source(),
    preflight: preflight({ sourceId: `sha256:${"b".repeat(64)}` }),
  }), /identities do not match/);

  assert.throws(() => createRiggingSource({
    contentId: SOURCE_ID,
    byteLength: 64,
    handle: { type: "rig/source-asset", id: "asset", scope: "document" },
  }), /scope must be session/);

  assert.throws(() => normalizeRiggingPreflight({
    ...preflight(),
    inventory: {
      ...preflight().inventory,
      nodes: { count: 65, roots: 1, items: Array.from({ length: 65 }, (_, index) => ({ index })), omitted: 0 },
    },
  }), /bounded item limit/);

  assert.throws(() => normalizeRiggingSession({
    ...createRiggingSession({ id: "rig-session:typed" }),
    extra: new Float32Array([1, 2, 3]),
  }), /Portable values/);
});

test("preflight status is derived from total issue counts rather than trusted input labels", () => {
  const report = preflight({
    issues: [{ code: "normal/missing", severity: "warning", path: "$.meshes[0]", message: "Normals are missing" }],
    summary: { errors: 0, warnings: 3, info: 0, omittedIssues: 2, status: "ready" },
  });
  assert.equal(report.summary.status, "warn");
  assert.equal(report.summary.warnings, 3);
  assert.equal(report.summary.omittedIssues, 2);
});
