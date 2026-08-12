import assert from "node:assert/strict";
import test from "node:test";
import {
  createRigAuthoringState,
  createRigDocument,
} from "@greenways/hodos-world-model/rigging";
import {
  createMemoryRigWorkfileProvider,
  createRigWorkfileAutosave,
  createWebStorageRigWorkfileProvider,
  rigWorkfileStorageKey,
} from "../src/rigging-workfile-browser.js";

function state() {
  return createRigAuthoringState({
    document: createRigDocument({
      id: "rig:test",
      assetId: "sha256:test",
      joints: [{ id: "root", parent: null }],
    }),
    editor: { selection: ["root"], active: "root", expanded: ["root"] },
    history: { limit: 9 },
    session: {
      active: {
        source: {
          contentId: "sha256:test",
          fileName: "test.glb",
          mediaType: "model/gltf-binary",
          handle: { id: "rig-asset:private" },
        },
      },
    },
  });
}

test("memory autosave stores a bounded workfile keyed by source identity", async () => {
  const provider = createMemoryRigWorkfileProvider();
  const autosave = createRigWorkfileAutosave({ provider, delay: 0 });
  const saved = await autosave.flush(state());
  assert.equal(saved.saved, true);
  assert.equal(saved.contentId, "sha256:test");
  const entries = provider.entries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0][0], rigWorkfileStorageKey("sha256:test"));
  assert.equal(entries[0][1].includes("rig-asset:private"), false);
  const loaded = await autosave.load("sha256:test");
  assert.equal(loaded.document.id, "rig:test");
  assert.deepEqual(loaded.editor.selection, ["root"]);
  assert.equal(loaded.history.limit, 9);
  await autosave.remove("sha256:test");
  assert.equal(provider.entries().length, 0);
  autosave.destroy();
});

test("scheduled autosave coalesces edits and writes the latest workfile", async () => {
  const provider = createMemoryRigWorkfileProvider();
  const callbacks = new Map();
  let sequence = 0;
  const timers = {
    setTimeout(callback) { const id = ++sequence; callbacks.set(id, callback); return id; },
    clearTimeout(id) { callbacks.delete(id); },
  };
  const autosave = createRigWorkfileAutosave({ provider, delay: 500, timers });
  assert.equal(autosave.schedule(state()), true);
  const next = createRigAuthoringState({ ...state(), document: { ...state().document, revision: 2 } });
  assert.equal(autosave.schedule(next), true);
  assert.equal(callbacks.size, 1);
  const callback = [...callbacks.values()][0];
  callback();
  await new Promise((resolve) => setImmediate(resolve));
  const loaded = await autosave.load("sha256:test");
  assert.equal(loaded.document.revision, 2);
  autosave.destroy();
});

test("autosave refuses states whose active source does not match the editable rig", async () => {
  const provider = createMemoryRigWorkfileProvider();
  const autosave = createRigWorkfileAutosave({ provider });
  const mismatched = createRigAuthoringState({
    ...state(),
    document: createRigDocument({ id: "rig:other", assetId: "sha256:other", joints: [{ id: "root", parent: null }] }),
  });
  assert.equal(autosave.schedule(mismatched), false);
  assert.deepEqual(await autosave.flush(mismatched), { saved: false, reason: "source-unavailable" });
  assert.deepEqual(provider.entries(), []);
  autosave.destroy();
});

test("Web Storage is adapted through the injected provider interface", async () => {
  const values = new Map();
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  const provider = createWebStorageRigWorkfileProvider(storage);
  await provider.set("rig", "value");
  assert.equal(await provider.get("rig"), "value");
  await provider.delete("rig");
  assert.equal(await provider.get("rig"), null);
});
