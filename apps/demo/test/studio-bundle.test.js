import assert from "node:assert/strict";
import test from "node:test";
import { readProjectBundle, readStoredZip } from "../src/studio-bundle.js";
import { createProjectBundle, createStoredZip } from "../src/studio-export.js";

test("Hodos Studio project bundle round-trips project and audio payloads", async () => {
  const project = {
    id: "project-garden",
    title: "Garden Song",
    assets: [{
      id: "sha256:abc",
      name: "garden.wav",
      mediaType: "audio/wav",
      duration: 2,
      channels: 2,
      sampleRate: 48000,
      storage: { type: "opfs", key: "assets/abc.bin" },
    }],
    tracks: [{
      id: "track-1",
      name: "Garden",
      gainDb: 0,
      mute: false,
      clips: [{ id: "clip-1", asset: "sha256:abc", startSeconds: 1, sourceStartSeconds: 0, duration: 2 }],
    }],
  };
  const bundle = await createProjectBundle({
    project,
    readAsset: async () => Uint8Array.from([82, 73, 70, 70]),
    now: () => "2026-08-04T00:00:00.000Z",
  });
  const imported = readProjectBundle(bundle);
  assert.equal(imported.project.id, "project-garden");
  assert.equal(imported.project.tracks[0].clips[0].startSeconds, 1);
  assert.equal(imported.assets.length, 1);
  assert.deepEqual([...imported.assets[0].bytes], [82, 73, 70, 70]);
  assert.deepEqual(imported.assets[0].asset.storage, {
    type: "bundle",
    path: imported.manifest.assets[0].path,
  });
});

test("bundle reader rejects unsafe paths and corrupt payloads", () => {
  const unsafe = createStoredZip({ "../outside": Uint8Array.from([1]) });
  assert.throws(() => readStoredZip(unsafe), /unsafe path segment/);

  const corrupt = createStoredZip({ "safe.bin": Uint8Array.from([1, 2, 3]) });
  const localDataOffset = 30 + "safe.bin".length;
  corrupt[localDataOffset] ^= 0xff;
  assert.throws(() => readStoredZip(corrupt), /CRC check/);
});

test("bundle reader accepts only stored ZIP entries", () => {
  const bundle = createStoredZip({ "safe.bin": Uint8Array.from([1]) });
  const view = new DataView(bundle.buffer, bundle.byteOffset, bundle.byteLength);
  view.setUint16(8, 8, true);
  assert.throws(() => readStoredZip(bundle), /stored method/);
});
