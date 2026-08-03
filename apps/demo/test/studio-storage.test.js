import assert from "node:assert/strict";
import test from "node:test";
import { createStudioStore, MemoryStudioBackend } from "../src/studio-storage.js";

test("memory studio storage round-trips immutable assets and project state", async () => {
  const store = createStudioStore({ backend: new MemoryStudioBackend() });
  const asset = { id: "sha256:audio", name: "take.wav" };
  const storage = await store.saveAsset(asset, Uint8Array.from([1, 2, 3, 4]));
  assert.deepEqual(storage, { type: "memory", key: "assets/sha256%3Aaudio.bin" });
  assert.deepEqual([...new Uint8Array(await store.readAsset({ ...asset, storage }))], [1, 2, 3, 4]);

  const project = { id: "local/current", title: "Saved", assets: [{ ...asset, storage }], tracks: [] };
  await store.saveProject(project);
  assert.deepEqual(await store.loadProject("local/current"), project);
  assert.equal(await store.loadProject("missing"), null);
});
