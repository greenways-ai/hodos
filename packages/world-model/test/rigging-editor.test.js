import assert from "node:assert/strict";
import test from "node:test";
import {
  RIG_AUTHORING_SCHEMA,
  RIG_EDITOR_SCHEMA,
  applyRigIntent,
  buildRigEditorIntent,
  buildRigIdMap,
  commitRigAuthoringIntent,
  createRigAuthoringState,
  createRigDocument,
  ensureRigRoot,
  flattenRigHierarchy,
  nextRigJointId,
  normalizeRigEditor,
  previewRigJoint,
  redoRigAuthoring,
  reduceRigAuthoringEvent,
  rigLocalPointToWorld,
  rigWorldPointToLocal,
  selectRigJoints,
  suggestedMirroredJointId,
  toggleRigJointExpanded,
  undoRigAuthoring,
} from "../src/rigging-model.js";

function flowerRig() {
  return createRigDocument({
    id: "rig:flower",
    assetId: "sha256:flower",
    joints: [
      { id: "root", parent: null, role: "root", rest: { translation: [1, 0, 0] } },
      { id: "left-petal-base", parent: "root", role: "petal", rest: { translation: [-1, 0.25, 0] } },
      { id: "left-petal-tip", parent: "left-petal-base", role: "petal-tip", rest: { translation: [-0.75, 0.5, 0] } },
      { id: "stamen", parent: "root", role: "stamen", rest: { translation: [0, 0.75, 0] } },
    ],
  });
}

test("rig editor state is portable and prunes unknown selection ids", () => {
  const document = flowerRig();
  const editor = normalizeRigEditor({
    tool: "translate",
    selection: ["left-petal-base", "missing"],
    active: "missing",
    focused: "left-petal-base",
    snap: { mode: "depth", translate: 0.05 },
  }, document);
  assert.equal(editor.schema, RIG_EDITOR_SCHEMA);
  assert.deepEqual(editor.selection, ["left-petal-base"]);
  assert.equal(editor.active, "left-petal-base");
  assert.equal(editor.focused, "left-petal-base");
  assert.equal(editor.snap.mode, "depth");
  assert.equal(editor.snap.translate, 0.05);
  assert.deepEqual(JSON.parse(JSON.stringify(editor)), editor);
});

test("selection modes and focus remain deterministic", () => {
  const document = flowerRig();
  let editor = normalizeRigEditor({}, document);
  editor = selectRigJoints(editor, ["root"], "replace", document);
  editor = selectRigJoints(editor, ["stamen"], "add", document);
  assert.deepEqual(editor.selection, ["root", "stamen"]);
  assert.equal(editor.active, "stamen");
  editor = selectRigJoints(editor, ["root"], "toggle", document);
  assert.deepEqual(editor.selection, ["stamen"]);
  assert.equal(editor.focused, "stamen");
});

test("accessible hierarchy projection respects expansion without losing validation", () => {
  const document = flowerRig();
  let editor = normalizeRigEditor({ expanded: ["root"] }, document);
  let projection = flattenRigHierarchy(document, editor);
  assert.deepEqual(projection.rows.map(({ id }) => id), ["root", "left-petal-base", "stamen"]);
  editor = toggleRigJointExpanded(editor, "left-petal-base", document);
  projection = flattenRigHierarchy(document, editor);
  assert.deepEqual(projection.rows.map(({ id, depth }) => [id, depth]), [
    ["root", 0],
    ["left-petal-base", 1],
    ["left-petal-tip", 2],
    ["stamen", 1],
  ]);
  assert.equal(projection.validation.valid, true);
});

test("world/local conversion accounts for parent translation, rotation and scale", () => {
  const halfTurnZ = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  const document = createRigDocument({
    id: "rig:transform",
    assetId: "sha256:transform",
    joints: [{
      id: "root",
      parent: null,
      rest: { translation: [1, 2, 3], rotation: halfTurnZ, scale: [2, 2, 2] },
    }],
  });
  const world = rigLocalPointToWorld(document, "root", [1, 0, 0]);
  assert.ok(Math.abs(world[0] - 1) < 1e-6);
  assert.ok(Math.abs(world[1] - 4) < 1e-6);
  assert.ok(Math.abs(world[2] - 3) < 1e-6);
  const local = rigWorldPointToLocal(document, "root", world);
  local.forEach((value, axis) => assert.ok(Math.abs(value - [1, 0, 0][axis]) < 1e-6));
});

test("editor actions build revision-checked create and move intents", () => {
  const document = flowerRig();
  const editor = normalizeRigEditor({
    selection: ["left-petal-base"],
    active: "left-petal-base",
    snap: { enabled: true, mode: "surface", translate: 0.25 },
  }, document);
  const create = buildRigEditorIntent(document, editor, {
    type: "create",
    jointId: "left-petal-extra",
    worldPosition: [-1.62, 0.76, 0.11],
  });
  assert.equal(create.type, "rig/joint-create");
  assert.equal(create.expectedRevision, document.revision);
  assert.equal(create.joint.parent, "left-petal-base");
  assert.deepEqual(create.joint.rest.translation, [-1.5, 0.5, 0]);

  const move = buildRigEditorIntent(document, editor, {
    type: "move",
    jointId: "left-petal-tip",
    worldPosition: [-0.51, 1.26, 0.24],
  });
  assert.equal(move.type, "rig/joint-update");
  assert.deepEqual(move.patch.rest.translation, [-0.5, 1, 0.25]);
});

test("duplicate intents preserve selected parent relationships and offset selected roots", () => {
  const document = flowerRig();
  const editor = normalizeRigEditor({
    selection: ["left-petal-base", "left-petal-tip"],
    active: "left-petal-tip",
  }, document);
  const intent = buildRigEditorIntent(document, editor, {
    type: "duplicate",
    offset: [0, 0, 1],
  });
  assert.equal(intent.type, "rig/joint-duplicate");
  const applied = applyRigIntent(document, intent);
  assert.equal(applied.ok, true);
  const copyBase = applied.document.joints.find(({ id }) => id === "left-petal-base-copy");
  const copyTip = applied.document.joints.find(({ id }) => id === "left-petal-tip-copy");
  assert.equal(copyBase.parent, "root");
  assert.equal(copyTip.parent, "left-petal-base-copy");
  assert.deepEqual(copyBase.rest.translation, [-1, 0.25, 1]);
  assert.deepEqual(copyTip.rest.translation, [-0.75, 0.5, 0]);
});

test("mirror mapping is anatomy-neutral and reports collisions before commit", () => {
  const document = flowerRig();
  assert.equal(suggestedMirroredJointId("left-petal-base"), "right-petal-base");
  assert.equal(suggestedMirroredJointId("wing.L"), "wing.r");
  assert.equal(suggestedMirroredJointId("tentacle"), "tentacle-mirror-x");
  const mapping = buildRigIdMap(document, ["left-petal-base", "left-petal-tip"], { kind: "mirror", axis: "x" });
  assert.deepEqual(mapping.collisions, []);
  assert.deepEqual(mapping.idMap, {
    "left-petal-base": "right-petal-base",
    "left-petal-tip": "right-petal-tip",
  });
  const collisionDocument = createRigDocument({
    ...document,
    joints: [...document.joints, { id: "right-petal-base", parent: "root" }],
  });
  assert.equal(buildRigIdMap(collisionDocument, ["left-petal-base"], { kind: "mirror" }).collisions[0].code,
    "rig/mirror-name-collision");
});

test("authoring history restores hierarchy and selection together", () => {
  const document = flowerRig();
  let state = createRigAuthoringState({
    document,
    editor: { selection: ["root"], active: "root", expanded: ["root"] },
  });
  assert.equal(state.schema, RIG_AUTHORING_SCHEMA);
  const intent = buildRigEditorIntent(state.document, state.editor, {
    type: "create",
    jointId: "new-petal",
    parentId: "root",
    worldPosition: [1, 1, 0],
  });
  state = commitRigAuthoringIntent(state, intent, {
    editorAfter: { selection: ["new-petal"], active: "new-petal", focused: "new-petal" },
  });
  assert.equal(state.document.joints.at(-1).id, "new-petal");
  assert.deepEqual(state.editor.selection, ["new-petal"]);
  assert.equal(state.history.undo.length, 1);

  state = undoRigAuthoring(state);
  assert.equal(state.document.joints.some(({ id }) => id === "new-petal"), false);
  assert.deepEqual(state.editor.selection, ["root"]);
  assert.equal(state.history.redo.length, 1);

  state = redoRigAuthoring(state);
  assert.equal(state.document.joints.some(({ id }) => id === "new-petal"), true);
  assert.deepEqual(state.editor.selection, ["new-petal"]);
});

test("stale intents do not pollute authoring history", () => {
  let state = createRigAuthoringState({ document: flowerRig() });
  state = commitRigAuthoringIntent(state, {
    type: "rig/joint-delete",
    jointId: "stamen",
    expectedRevision: 99,
  });
  assert.equal(state.history.undo.length, 0);
  assert.equal(state.lastOutcome.status, "rejected");
  assert.equal(state.document.joints.some(({ id }) => id === "stamen"), true);
});

test("event reducer accepts Studio history aliases and portable round trips", () => {
  let state = createRigAuthoringState({ document: flowerRig() });
  state = reduceRigAuthoringEvent(state, {
    "event/type": "rig/editor-select",
    jointId: "stamen",
  });
  const intent = buildRigEditorIntent(state.document, state.editor, {
    type: "rename",
    nextId: "pollen",
  });
  state = reduceRigAuthoringEvent(state, {
    "event/type": "rig/intent",
    intent,
    editorAfter: { selection: ["pollen"], active: "pollen", focused: "pollen" },
  });
  assert.equal(state.document.joints.some(({ id }) => id === "pollen"), true);
  state = reduceRigAuthoringEvent(state, { "event/type": "studio/history-undo" });
  assert.equal(state.document.joints.some(({ id }) => id === "stamen"), true);
  assert.deepEqual(createRigAuthoringState(JSON.parse(JSON.stringify(state))), state);
});

test("preview documents do not advance the canonical revision", () => {
  const document = flowerRig();
  const preview = previewRigJoint(document, "left-petal-tip", [-1, 1.5, 0.5]);
  assert.equal(preview.revision, document.revision);
  assert.equal(document.joints.find(({ id }) => id === "left-petal-tip").rest.translation[2], 0);
  assert.equal(preview.joints.find(({ id }) => id === "left-petal-tip").rest.translation[2], 0.5);
});

test("empty documents gain an explicit root and deterministic next ids", () => {
  const empty = createRigDocument({ id: "rig:empty", assetId: "sha256:empty" });
  const rooted = ensureRigRoot(empty);
  assert.equal(rooted.joints[0].id, "root");
  assert.equal(rooted.revision, 1);
  assert.equal(nextRigJointId(rooted, "root"), "root-2");
});
