import assert from "node:assert/strict";
import test from "node:test";
import { installProjectBundle } from "../src/studio-bundle-import.js";
import { createProjectBundle } from "../src/studio-export.js";
import { createStudioStore, MemoryStudioBackend } from "../src/studio-storage.js";

async function fixture() {
  const project = {
    id: "portable-project",
    title: "Portable Song",
    assets: [{
      id: "sha256:expected",
      name: "take.wav",
      mediaType: "audio/wav",
      duration: 1,
      channels: 1,
      sampleRate: 48000,
      storage: { type: "opfs", key: "assets/old.bin" },
    }],
    tracks: [{
      id: "track-1",
      name: "Take",
      gainDb: 0,
      mute: false,
      clips: [{ id: "clip-1", asset: "sha256:expected", startSeconds: 0, sourceStartSeconds: 0, duration: 1 }],
    }],
  };
  return createProjectBundle({
    project,
    readAsset: async () => Uint8Array.from([1, 2, 3, 4]),
    now: () => "2026-08-04T00:00:00.000Z",
  });
}

test("bundle installer verifies, persists and retargets portable projects", async () => {
  const store = createStudioStore({ backend: new MemoryStudioBackend() });
  const installed = await installProjectBundle(await fixture(), {
    store,
    currentProjectId: "local/current",
    digest: async () => "sha256:expected",
  });
  assert.equal(installed.project.id, "local/current");
  assert.deepEqual(installed.project.importedFrom, {
    projectId: "portable-project",
    exportedAt: "2026-08-04T00:00:00.000Z",
  });
  assert.equal(installed.project.assets[0].storage.type, "memory");
  assert.deepEqual(
    [...new Uint8Array(await store.readAsset(installed.project.assets[0]))],
    [1, 2, 3, 4],
  );
  assert.deepEqual(await store.loadActiveProject(), installed.project);
});

test("bundle installer rejects content that violates a SHA-256 identity", async () => {
  const store = createStudioStore({ backend: new MemoryStudioBackend() });
  await assert.rejects(
    installProjectBundle(await fixture(), {
      store,
      digest: async () => "sha256:different",
    }),
    /does not match its SHA-256 identity/,
  );
  assert.equal(await store.loadActiveProject(), null);
});
