import assert from "node:assert/strict";
import test from "node:test";
import {
  RIG_WORKFILE_SCHEMA,
  createRigAuthoringState,
  createRigDocument,
  createRigWorkfile,
  parseRigWorkfileJson,
  prepareRigWorkfileRestore,
  reduceRigAuthoringEvent,
  serializeRigWorkfileEdn,
  serializeRigWorkfileJson,
} from "../src/rigging-model.js";

function authoring(assetId = "sha256:source") {
  return createRigAuthoringState({
    document: { ...createRigDocument({
      id: "rig:lotus",
      assetId,
      joints: [
        { id: "root", parent: null, role: "root" },
        {
          id: "petal-base",
          parent: "root",
          role: "petal",
          rest: { translation: [0, 0.25, 0] },
          limits: { swing: 0.6, twist: [-0.2, 0.2] },
        },
      ],
      skin: { weightSetId: "weights:accepted", maxInfluences: 4 },
      bind: { inverseMatricesId: "bind:accepted" },
    }), revision: 7 },
    editor: {
      selection: ["petal-base"],
      active: "petal-base",
      focused: "petal-base",
      expanded: ["root"],
      tool: "translate",
    },
    history: {
      limit: 17,
      undo: [{
        document: createRigDocument({ id: "rig:old", assetId, joints: [{ id: "root", parent: null }] }),
        editor: {},
      }],
      redo: [],
    },
    session: {
      active: {
        source: {
          contentId: assetId,
          fileName: "lotus.glb",
          mediaType: "model/gltf-binary",
          handle: { id: "rig-asset:private" },
        },
        preflight: { decoded: [1, 2, 3] },
      },
    },
    lastOutcome: { renderer: "not-saved" },
  });
}

test("rig workfiles preserve editable source state without session or undo snapshots", () => {
  const workfile = createRigWorkfile(authoring(), { metadata: { title: "Lotus rig" } });
  assert.equal(workfile.schema, RIG_WORKFILE_SCHEMA);
  assert.equal(workfile.source.contentId, "sha256:source");
  assert.equal(workfile.source.fileName, "lotus.glb");
  assert.equal(workfile.document.skin.weightSetId, "weights:accepted");
  assert.equal(workfile.document.bind.inverseMatricesId, "bind:accepted");
  assert.deepEqual(workfile.editor.selection, ["petal-base"]);
  assert.deepEqual(workfile.editor.expanded, ["root"]);
  assert.deepEqual(workfile.history, { limit: 17 });
  assert.equal("session" in workfile, false);
  assert.equal("undo" in workfile.history, false);
  assert.equal(JSON.stringify(workfile).includes("rig-asset:private"), false);
  assert.equal(JSON.stringify(workfile).includes("decoded"), false);
});

test("canonical JSON and EDN-compatible text are deterministic", () => {
  const workfile = createRigWorkfile(authoring(), { metadata: { z: 1, a: { y: true, x: false } } });
  const first = serializeRigWorkfileJson(workfile);
  const second = serializeRigWorkfileJson({
    history: workfile.history,
    metadata: { a: { x: false, y: true }, z: 1 },
    document: workfile.document,
    source: workfile.source,
    editor: workfile.editor,
    schema: workfile.schema,
  });
  assert.equal(first, second);
  assert.deepEqual(parseRigWorkfileJson(first), workfile);
  const edn = serializeRigWorkfileEdn(workfile);
  assert.match(edn, /^\{"document" /);
  assert.match(edn, /"schema" "hodos\.rig-workfile\/0-alpha"/);
});

test("matching-source restore produces a bounded replace event and clears undo history", () => {
  const current = authoring();
  const workfile = createRigWorkfile(current);
  const changed = createRigAuthoringState({
    ...current,
    document: createRigDocument({ id: "rig:changed", assetId: "sha256:source", joints: [{ id: "root", parent: null }] }),
  });
  const prepared = prepareRigWorkfileRestore(changed, workfile);
  assert.equal(prepared.ok, true);
  assert.equal(prepared.event["event/type"], "rig/authoring-replace");
  const restored = reduceRigAuthoringEvent(changed, prepared.event);
  assert.equal(restored.document.id, "rig:lotus");
  assert.equal(restored.document.joints.length, 2);
  assert.deepEqual(restored.editor.selection, ["petal-base"]);
  assert.equal(restored.history.limit, 17);
  assert.deepEqual(restored.history.undo, []);
  assert.deepEqual(restored.history.redo, []);
  assert.equal(restored.session.active.source.contentId, "sha256:source");
});

test("source mismatch rejects without changing state unless explicit rebind is selected", () => {
  const current = authoring("sha256:active");
  const saved = createRigWorkfile(authoring("sha256:saved"));
  const rejected = prepareRigWorkfileRestore(current, saved);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "rig/workfile-source-mismatch");
  assert.deepEqual(rejected.state, current);

  const rebound = prepareRigWorkfileRestore(current, saved, { mismatchPolicy: "rebind" });
  assert.equal(rebound.ok, true);
  assert.equal(rebound.source.rebound, true);
  assert.equal(rebound.event.document.assetId, "sha256:active");
  assert.equal(rebound.event.document.revision, saved.document.revision + 1);
  assert.equal(rebound.event.document.skin.weightSetId, null);
  assert.equal(rebound.event.document.bind.inverseMatricesId, null);
  assert.equal(rebound.warnings[0].code, "rig/workfile-source-rebound");
  const restored = reduceRigAuthoringEvent(current, rebound.event);
  assert.equal(restored.document.assetId, "sha256:active");
});

test("restore requires a reopened source and invalid input preserves current authoring", () => {
  const state = createRigAuthoringState({
    document: createRigDocument({ id: "rig:offline", assetId: "sha256:source", joints: [{ id: "root", parent: null }] }),
  });
  const saved = createRigWorkfile(authoring());
  const missing = prepareRigWorkfileRestore(state, saved);
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "rig/workfile-source-required");
  assert.deepEqual(missing.state, state);

  const invalid = prepareRigWorkfileRestore(authoring(), '{"schema":"wrong"}');
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "rig/workfile-invalid");
  assert.deepEqual(invalid.state, authoring());
});

test("workfile parsing is bounded before JSON materialization", () => {
  const text = serializeRigWorkfileJson(createRigWorkfile(authoring()));
  assert.throws(() => parseRigWorkfileJson(text, { maximumBytes: 256 }), /bounded limit/i);
  assert.throws(() => createRigWorkfile(authoring(), { metadata: { huge: "x".repeat(40_000) } }), /metadata/i);
});
