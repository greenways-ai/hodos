import assert from "node:assert/strict";
import test from "node:test";
import { createRiggingSession } from "@greenways/hodos-world-model/rigging";
import {
  LocalRiggingAssetHost,
  createLocalRiggingAssetHost,
} from "@greenways/hodos-renderer-playcanvas/rigging-assets";
import { createStylizedUnriggedGlb } from "./fixtures/stylized-unrigged-glb.js";

const FIXTURE_ID = "sha256:30537e076973248245843569058fd0d70181ae868046dccce0f106c7ff58a015";

test("host opens a local GLB without network access and keeps bytes behind an opaque handle", async () => {
  const host = createLocalRiggingAssetHost({ id: "test" });
  const bytes = createStylizedUnriggedGlb();
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => {
    fetchCalls += 1;
    throw new Error("Local open must not fetch");
  };
  try {
    const opened = await host.open(createRiggingSession({ id: "session:one" }), bytes, {
      fileName: "opal-creature.glb",
    });
    assert.equal(opened.ok, true);
    assert.equal(fetchCalls, 0);
    assert.equal(opened.source.contentId, FIXTURE_ID);
    assert.equal(opened.session.status, "ready");
    assert.equal(opened.session.active.source.handle.id, opened.handle);
    assert.equal(host.has(opened.handle), true);
    assert.equal(host.describe(opened.handle).preflight.sourceId, FIXTURE_ID);
    assert.equal(JSON.stringify(opened.session).includes("bufferViews"), false);
    assert.equal(JSON.stringify(opened.session).includes("Uint8Array"), false);

    const firstCopy = host.readBytes(opened.handle);
    const originalFirstByte = firstCopy[0];
    firstCopy[0] = 0;
    assert.equal(host.readBytes(opened.handle)[0], originalFirstByte);
    const document = host.readDocument(opened.handle);
    document.nodes[0].name = "Changed outside host";
    assert.equal(host.readDocument(opened.handle).nodes[0].name, "Disconnected body");
  } finally {
    globalThis.fetch = previousFetch;
    host.destroy();
  }
});

test("the same source bytes produce the same content identity and portable preflight across hosts", async () => {
  const bytes = createStylizedUnriggedGlb();
  const left = new LocalRiggingAssetHost({ id: "left" });
  const right = new LocalRiggingAssetHost({ id: "right" });
  try {
    const first = await left.open(createRiggingSession({ id: "session:left" }), bytes);
    const second = await right.open(createRiggingSession({ id: "session:right" }), bytes);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.source.contentId, second.source.contentId);
    assert.deepEqual(first.preflight, second.preflight);
    assert.notEqual(first.handle, second.handle);
  } finally {
    left.destroy();
    right.destroy();
  }
});

test("failed replacement decode preserves the prior active session and handle", async () => {
  const host = createLocalRiggingAssetHost({ id: "recover" });
  try {
    const accepted = await host.open(createRiggingSession({ id: "session:recover" }), createStylizedUnriggedGlb(), {
      fileName: "working.glb",
    });
    assert.equal(accepted.ok, true);
    const failed = await host.open(accepted.session, new Uint8Array([1, 2, 3, 4]), {
      fileName: "broken.glb",
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.session.status, "ready");
    assert.equal(failed.session.revision, 2);
    assert.equal(failed.session.active.source.contentId, FIXTURE_ID);
    assert.equal(failed.session.active.source.handle.id, accepted.handle);
    assert.equal(failed.session.lastAttempt.status, "failed");
    assert.equal(failed.session.lastAttempt.recoverable, true);
    assert.equal(failed.error.code, "glb/too-small");
    assert.match(failed.session.lastAttempt.sourceId, /^sha256:[0-9a-f]{64}$/);
    assert.equal(host.evidence().assets, 1);
    assert.equal(host.has(accepted.handle), true);
  } finally {
    host.destroy();
  }
});

test("Blob-like local sources are accepted and asset release is deterministic", async () => {
  const bytes = createStylizedUnriggedGlb();
  const source = {
    name: "blob-model.glb",
    type: "model/gltf-binary",
    size: bytes.byteLength,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
  const host = createLocalRiggingAssetHost({ id: "blob" });
  const opened = await host.open(createRiggingSession({ id: "session:blob" }), source);
  assert.equal(opened.ok, true);
  assert.equal(opened.source.fileName, "blob-model.glb");
  assert.equal(opened.source.mediaType, "model/gltf-binary");
  assert.equal(host.release(opened.handle), true);
  assert.equal(host.release(opened.handle), false);
  assert.equal(host.evidence().assets, 0);
  assert.throws(() => host.readBytes(opened.handle), /Unknown local rigging asset handle/);
  host.destroy();
  assert.deepEqual(host.evidence(), {
    provider: { id: "playcanvas/glb-preflight", version: "0-alpha.1" },
    hostId: "blob",
    assets: 0,
    totalBytes: 0,
    maximumAssets: 8,
    maximumTotalBytes: 512 * 1024 * 1024,
    destroyed: true,
  });
});

test("host byte limits fail closed without adding an asset", async () => {
  const host = createLocalRiggingAssetHost({
    id: "bounded",
    preflight: { maximumBytes: 32 },
  });
  try {
    const result = await host.open(createRiggingSession({ id: "session:bounded" }), createStylizedUnriggedGlb());
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "glb/byte-limit");
    assert.equal(result.session.status, "failed");
    assert.equal(host.evidence().assets, 0);
  } finally {
    host.destroy();
  }
});


test("host asset and byte capacities fail without discarding the accepted session", async () => {
  const bytes = createStylizedUnriggedGlb();
  const host = createLocalRiggingAssetHost({
    id: "capacity",
    maximumAssets: 1,
    maximumTotalBytes: bytes.byteLength * 2,
  });
  try {
    const accepted = await host.open(createRiggingSession({ id: "session:capacity" }), bytes);
    assert.equal(accepted.ok, true);
    const rejected = await host.open(accepted.session, bytes, { fileName: "second.glb" });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, "rig/asset-capacity");
    assert.equal(rejected.session.active.source.handle.id, accepted.handle);
    assert.equal(host.evidence().assets, 1);
  } finally {
    host.destroy();
  }
});
