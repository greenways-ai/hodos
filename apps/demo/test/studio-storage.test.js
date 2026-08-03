import assert from "node:assert/strict";
import test from "node:test";
import { createStudioStore, MemoryStudioBackend } from "../src/studio-storage.js";

test("memory studio storage round-trips immutable assets and project state", async () => {
  const store = createStudioStore({ backend: new MemoryStudioBackend() });
  const asset = { id: "sha256:audio", name: "take.wav" };
  const storage = await store.saveAsset(asset, Uint8Array.from([1, 2, 3, 4]));
  assert.deepEqual(storage, { type: "memory", key: "assets/sha256%3Aaudio.bin" });
  assert.deepEqual([...new Uint8Array(await store.readAsset({ ...asset, storage }))], [1, 2, 3, 4]);

  const project = { id: "project-saved", title: "Saved", assets: [{ ...asset, storage }], tracks: [] };
  await store.saveProject(project);
  assert.equal(await store.activeProjectId(), "project-saved");
  assert.deepEqual(await store.loadProject("project-saved"), project);
  assert.deepEqual(await store.loadActiveProject(), project);
  assert.equal(await store.loadProject("missing"), null);
});

test("active project falls back to the conventional local project", async () => {
  const store = createStudioStore({ backend: new MemoryStudioBackend() });
  const project = { id: "local/current", title: "Fallback", assets: [], tracks: [] };
  await store.backend.write(store.projectPath(project.id), new TextEncoder().encode(JSON.stringify({
    format: "hodos-studio-project",
    version: "0.1.0",
    savedAt: "2026-08-04T00:00:00.000Z",
    project,
  })));
  assert.deepEqual(await store.loadActiveProject(), project);
});
