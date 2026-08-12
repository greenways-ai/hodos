import {
  buildRigEditorIntent,
  normalizeRigEditor,
} from "./rigging-editor.js";
import { rigRestWorldTransforms } from "./rigging-document.js";
import { normalizeRigDocument } from "./rigging-validation.js";
import {
  finiteNumber,
  isPlainObject,
  requiredString,
  vector,
} from "./rigging-values.js";

export const RIG_MOVE_TRANSACTION_SCHEMA = "hodos.rig-move-transaction/0-alpha";
export const RIG_NUDGE_KEYS = Object.freeze([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
]);

const KEY_DELTAS = Object.freeze({
  ArrowLeft: [-1, 0, 0],
  ArrowRight: [1, 0, 0],
  ArrowUp: [0, 1, 0],
  ArrowDown: [0, -1, 0],
  PageUp: [0, 0, 1],
  PageDown: [0, 0, -1],
});

function moveTransaction(value) {
  if (!isPlainObject(value) || value.schema !== RIG_MOVE_TRANSACTION_SCHEMA) {
    throw new TypeError(`Rig move transaction schema must be ${RIG_MOVE_TRANSACTION_SCHEMA}`);
  }
  return {
    schema: RIG_MOVE_TRANSACTION_SCHEMA,
    jointId: requiredString(value.jointId, "transaction.jointId"),
    revision: Number(value.revision),
    source: requiredString(value.source ?? "keyboard", "transaction.source"),
    start: vector(value.start, [0, 0, 0], 3, "transaction.start"),
    current: vector(value.current, value.start, 3, "transaction.current"),
    steps: Number.isSafeInteger(value.steps) && value.steps >= 0 ? value.steps : 0,
  };
}

export function rigJointWorldPosition(documentValue, jointIdValue) {
  const document = normalizeRigDocument(documentValue);
  const jointId = requiredString(jointIdValue, "jointId");
  const entry = rigRestWorldTransforms(document).find((candidate) => candidate.id === jointId);
  if (!entry) throw new RangeError(`Unknown joint: ${jointId}`);
  return [...entry.translation];
}

export function rigNudgeStep({
  baseStep = 0.01,
  fineStep = null,
  coarseStep = null,
  altKey = false,
  shiftKey = false,
} = {}) {
  const base = Math.max(0.000001, finiteNumber(baseStep, 0.01, "baseStep"));
  const fine = fineStep === null ? base / 10 : Math.max(0.000001, finiteNumber(fineStep, base / 10, "fineStep"));
  const coarse = coarseStep === null ? base * 10 : Math.max(0.000001, finiteNumber(coarseStep, base * 10, "coarseStep"));
  if (altKey) return fine;
  if (shiftKey) return coarse;
  return base;
}

export function rigNudgeDelta(keyValue, options = {}) {
  const key = requiredString(keyValue, "key");
  const direction = KEY_DELTAS[key];
  if (!direction) return null;
  const step = rigNudgeStep(options);
  return direction.map((entry) => entry * step);
}

export function createRigMoveTransaction(documentValue, editorValue = {}, {
  jointId: jointIdValue = null,
  source = "keyboard",
} = {}) {
  const document = normalizeRigDocument(documentValue);
  const editor = normalizeRigEditor(editorValue, document);
  const jointId = requiredString(jointIdValue ?? editor.active, "jointId");
  const position = rigJointWorldPosition(document, jointId);
  return Object.freeze({
    schema: RIG_MOVE_TRANSACTION_SCHEMA,
    jointId,
    revision: document.revision,
    source: requiredString(source, "source"),
    start: Object.freeze([...position]),
    current: Object.freeze([...position]),
    steps: 0,
  });
}

export function updateRigMoveTransaction(transactionValue, worldPositionValue) {
  const transaction = moveTransaction(transactionValue);
  const current = vector(worldPositionValue, transaction.current, 3, "worldPosition");
  return Object.freeze({
    ...transaction,
    start: Object.freeze([...transaction.start]),
    current: Object.freeze([...current]),
    steps: transaction.steps + 1,
  });
}

export function nudgeRigMoveTransaction(transactionValue, keyValue, options = {}) {
  const transaction = moveTransaction(transactionValue);
  const delta = rigNudgeDelta(keyValue, options);
  if (!delta) return Object.freeze({
    ...transaction,
    start: Object.freeze([...transaction.start]),
    current: Object.freeze([...transaction.current]),
  });
  return updateRigMoveTransaction(
    transaction,
    transaction.current.map((entry, axis) => entry + delta[axis]),
  );
}

export function buildRigMoveTransactionIntent(documentValue, editorValue, transactionValue) {
  const document = normalizeRigDocument(documentValue);
  const editor = normalizeRigEditor(editorValue, document);
  const transaction = moveTransaction(transactionValue);
  if (transaction.revision !== document.revision) {
    throw new RangeError(`Stale rig move transaction: expected revision ${transaction.revision}, found ${document.revision}`);
  }
  if (!document.joints.some((joint) => joint.id === transaction.jointId)) {
    throw new RangeError(`Unknown joint: ${transaction.jointId}`);
  }
  return buildRigEditorIntent(document, editor, {
    type: "move",
    jointId: transaction.jointId,
    worldPosition: transaction.current,
  });
}
