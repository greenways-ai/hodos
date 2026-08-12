import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRigMoveTransactionIntent,
  createRigMoveTransaction,
  nudgeRigMoveTransaction,
  rigNudgeDelta,
  rigNudgeStep,
  updateRigMoveTransaction,
} from "../src/rigging-input.js";
import { createRigDocument } from "../src/rigging-validation.js";
import { addRigJoint, updateRigJoint } from "../src/rigging-document.js";
import { normalizeRigEditor } from "../src/rigging-editor.js";

function fixture() {
  let document = createRigDocument({ id: "rig:keyboard", assetId: "sha256:keyboard" });
  document = addRigJoint(document, { id: "root", parent: null, rest: { translation: [0, 0, 0] } });
  document = addRigJoint(document, { id: "joint", parent: "root", rest: { translation: [1, 2, 3] } });
  const editor = normalizeRigEditor({ selection: ["joint"], active: "joint", focused: "joint" }, document);
  return { document, editor };
}

test("keyboard nudge mapping uses normal, fine and coarse steps", () => {
  assert.equal(rigNudgeStep({ baseStep: 0.1 }), 0.1);
  assert.equal(rigNudgeStep({ baseStep: 0.1, altKey: true }), 0.01);
  assert.equal(rigNudgeStep({ baseStep: 0.1, shiftKey: true }), 1);
  assert.deepEqual(rigNudgeDelta("ArrowLeft", { baseStep: 0.5 }), [-0.5, 0, 0]);
  assert.deepEqual(rigNudgeDelta("ArrowUp", { baseStep: 0.5 }), [0, 0.5, 0]);
  assert.deepEqual(rigNudgeDelta("PageDown", { baseStep: 0.5 }), [0, 0, -0.5]);
  assert.equal(rigNudgeDelta("Home", { baseStep: 0.5 }), null);
});

test("repeated keyboard input accumulates in one transient move transaction", () => {
  const { document, editor } = fixture();
  let transaction = createRigMoveTransaction(document, editor, { source: "keyboard" });
  transaction = nudgeRigMoveTransaction(transaction, "ArrowRight", { baseStep: 0.25 });
  transaction = nudgeRigMoveTransaction(transaction, "ArrowRight", { baseStep: 0.25 });
  transaction = nudgeRigMoveTransaction(transaction, "PageUp", { baseStep: 0.5 });
  assert.deepEqual(transaction.start, [1, 2, 3]);
  assert.deepEqual(transaction.current, [1.5, 2, 3.5]);
  assert.equal(transaction.steps, 3);
  const intent = buildRigMoveTransactionIntent(document, editor, transaction);
  assert.equal(intent.type, "rig/joint-update");
  assert.equal(intent.jointId, "joint");
  assert.deepEqual(intent.patch.rest.translation, [1.5, 2, 3.5]);
});

test("numeric preview updates remain transient until an explicit intent is built", () => {
  const { document, editor } = fixture();
  const transaction = updateRigMoveTransaction(
    createRigMoveTransaction(document, editor, { source: "numeric" }),
    [8, 9, 10],
  );
  assert.deepEqual(document.joints.find(({ id }) => id === "joint").rest.translation, [1, 2, 3]);
  assert.deepEqual(buildRigMoveTransactionIntent(document, editor, transaction).patch.rest.translation, [8, 9, 10]);
});

test("stale move transactions fail before producing a semantic command", () => {
  const { document, editor } = fixture();
  const transaction = createRigMoveTransaction(document, editor);
  const advanced = updateRigJoint(document, "joint", { role: "advanced" });
  assert.throws(
    () => buildRigMoveTransactionIntent(advanced, editor, transaction),
    /Stale rig move transaction/,
  );
});
