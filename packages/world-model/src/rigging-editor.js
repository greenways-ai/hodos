import {
  addRigJoint,
  rigRestWorldTransforms,
} from "./rigging-document.js";
import { applyRigIntent } from "./rigging-intents.js";
import {
  AXES,
  RIG_AUTHORING_SCHEMA,
  RIG_EDITOR_SCHEMA,
  RIG_INTENT_SCHEMA,
  RIG_OUTCOME_SCHEMA,
  clonePortable,
  finiteNumber,
  isPlainObject,
  optionalString,
  requiredString,
  safeInteger,
  vector,
} from "./rigging-values.js";
import {
  createRigDocument,
  normalizeRigDocument,
  validateRigDocument,
} from "./rigging-validation.js";

export const RIG_EDITOR_MODES = Object.freeze(["edit", "preview"]);
export const RIG_EDITOR_TOOLS = Object.freeze(["select", "joint-create", "translate"]);
export const RIG_EDITOR_SPACES = Object.freeze(["world", "local"]);
export const RIG_EDITOR_SELECTION_MODES = Object.freeze(["replace", "add", "toggle", "subtract"]);
export const RIG_SNAP_MODES = Object.freeze(["surface", "depth", "grid", "none"]);
export const DEFAULT_RIG_HISTORY_LIMIT = 64;
export const MAX_RIG_HISTORY_LIMIT = 256;

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function uniqueStrings(values = [], label = "values") {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  return [...new Set(values.map((entry, index) => requiredString(entry, `${label}[${index}]`)))];
}

function knownJointIds(document) {
  return new Set(document.joints.map((joint) => joint.id));
}

function normalizedSelection(value, document) {
  const ids = knownJointIds(document);
  const selected = uniqueStrings(value ?? [], "editor.selection").filter((id) => ids.has(id));
  return selected;
}

function normalizedExpanded(value, document) {
  const ids = knownJointIds(document);
  const fallback = document.joints.filter((joint) => joint.parent === null).map((joint) => joint.id);
  return uniqueStrings(value ?? fallback, "editor.expanded").filter((id) => ids.has(id));
}

function normalizeRigSnap(value = {}) {
  if (!isPlainObject(value)) throw new TypeError("editor.snap must be an object");
  const mode = RIG_SNAP_MODES.includes(value.mode) ? value.mode : "surface";
  return {
    enabled: value.enabled !== false,
    mode,
    translate: Math.max(0.0001, finiteNumber(value.translate, 0.01, "editor.snap.translate")),
    depth: finiteNumber(value.depth, 0, "editor.snap.depth"),
    surfaceOffset: finiteNumber(value.surfaceOffset, 0, "editor.snap.surfaceOffset"),
  };
}

export function normalizeRigEditor(value = {}, documentValue = {}) {
  if (!isPlainObject(value)) throw new TypeError("Rig editor state must be an object");
  clonePortable(value);
  if (value.schema !== undefined && value.schema !== RIG_EDITOR_SCHEMA) {
    throw new TypeError(`Rig editor schema must be ${RIG_EDITOR_SCHEMA}`);
  }
  const document = normalizeRigDocument(documentValue);
  const selection = normalizedSelection(value.selection, document);
  const activeCandidate = optionalString(value.active, "editor.active");
  const active = activeCandidate && selection.includes(activeCandidate)
    ? activeCandidate
    : selection.at(-1) ?? null;
  const focusedCandidate = optionalString(value.focused, "editor.focused");
  const focused = focusedCandidate && knownJointIds(document).has(focusedCandidate)
    ? focusedCandidate
    : active ?? document.joints[0]?.id ?? null;
  return {
    schema: RIG_EDITOR_SCHEMA,
    mode: RIG_EDITOR_MODES.includes(value.mode) ? value.mode : "edit",
    tool: RIG_EDITOR_TOOLS.includes(value.tool) ? value.tool : "select",
    space: RIG_EDITOR_SPACES.includes(value.space) ? value.space : "world",
    selection,
    active,
    focused,
    expanded: normalizedExpanded(value.expanded, document),
    snap: normalizeRigSnap(value.snap),
  };
}

export function selectRigJoints(editorValue, incomingValue, mode = "replace", documentValue = {}) {
  const document = normalizeRigDocument(documentValue);
  const editor = normalizeRigEditor(editorValue, document);
  if (!RIG_EDITOR_SELECTION_MODES.includes(mode)) throw new TypeError(`Unsupported rig selection mode: ${mode}`);
  const incoming = normalizedSelection(incomingValue ?? [], document);
  const selected = new Map(editor.selection.map((id) => [id, id]));
  if (mode === "replace") selected.clear();
  for (const id of incoming) {
    if (mode === "subtract") selected.delete(id);
    else if (mode === "toggle" && selected.has(id)) selected.delete(id);
    else selected.set(id, id);
  }
  const selection = [...selected.values()];
  const active = incoming.at(-1) && selection.includes(incoming.at(-1))
    ? incoming.at(-1)
    : selection.at(-1) ?? null;
  return normalizeRigEditor({
    ...editor,
    selection,
    active,
    focused: active ?? editor.focused,
  }, document);
}

export function toggleRigJointExpanded(editorValue, jointIdValue, documentValue = {}) {
  const document = normalizeRigDocument(documentValue);
  const editor = normalizeRigEditor(editorValue, document);
  const jointId = requiredString(jointIdValue, "jointId");
  if (!knownJointIds(document).has(jointId)) throw new RangeError(`Unknown joint: ${jointId}`);
  const expanded = new Set(editor.expanded);
  if (expanded.has(jointId)) expanded.delete(jointId);
  else expanded.add(jointId);
  return normalizeRigEditor({ ...editor, expanded: [...expanded], focused: jointId }, document);
}

function issuesByJoint(document) {
  const validation = validateRigDocument(document);
  const byId = new Map(document.joints.map((joint) => [joint.id, []]));
  const jointPattern = /^\$\.joints\[(\d+)\]/;
  for (const entry of [...validation.errors, ...validation.warnings]) {
    const index = Number(jointPattern.exec(entry.path)?.[1]);
    const id = Number.isSafeInteger(index) ? document.joints[index]?.id : null;
    if (id) byId.get(id).push({ ...entry });
  }
  return { validation, byId };
}

export function flattenRigHierarchy(documentValue = {}, editorValue = {}, { includeCollapsed = false } = {}) {
  const document = normalizeRigDocument(documentValue);
  const editor = normalizeRigEditor(editorValue, document);
  const children = new Map(document.joints.map((joint) => [joint.id, []]));
  for (const joint of document.joints) if (joint.parent) children.get(joint.parent)?.push(joint.id);
  const indexById = new Map(document.joints.map((joint, index) => [joint.id, index]));
  const jointById = new Map(document.joints.map((joint) => [joint.id, joint]));
  const { validation, byId } = issuesByJoint(document);
  const rows = [];
  const visit = (id, depth) => {
    const joint = jointById.get(id);
    if (!joint) return;
    const childIds = children.get(id) ?? [];
    const expanded = editor.expanded.includes(id);
    rows.push({
      id,
      parent: joint.parent,
      role: joint.role,
      index: indexById.get(id),
      depth,
      childCount: childIds.length,
      hasChildren: childIds.length > 0,
      expanded,
      selected: editor.selection.includes(id),
      active: editor.active === id,
      focused: editor.focused === id,
      issues: (byId.get(id) ?? []).map((entry) => ({ ...entry })),
    });
    if (includeCollapsed || expanded) childIds.forEach((child) => visit(child, depth + 1));
  };
  document.joints.filter((joint) => joint.parent === null).forEach((joint) => visit(joint.id, 0));
  return {
    rows,
    validation: {
      valid: validation.valid,
      errors: validation.errors.map((entry) => ({ ...entry })),
      warnings: validation.warnings.map((entry) => ({ ...entry })),
      truncated: validation.truncated,
    },
  };
}

export function rigJointSubtree(documentValue, jointIdValue) {
  const document = normalizeRigDocument(documentValue);
  const jointId = requiredString(jointIdValue, "jointId");
  if (!document.joints.some((joint) => joint.id === jointId)) throw new RangeError(`Unknown joint: ${jointId}`);
  const selected = new Set([jointId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const joint of document.joints) {
      if (joint.parent && selected.has(joint.parent) && !selected.has(joint.id)) {
        selected.add(joint.id);
        changed = true;
      }
    }
  }
  return document.joints.filter((joint) => selected.has(joint.id)).map((joint) => joint.id);
}

export function nextRigJointId(documentValue, prefixValue = "joint") {
  const document = normalizeRigDocument(documentValue);
  const prefix = requiredString(prefixValue, "prefix").replace(/[^a-zA-Z0-9._/-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!prefix) throw new TypeError("prefix must contain at least one portable id character");
  const ids = knownJointIds(document);
  if (!ids.has(prefix)) return prefix;
  for (let index = 2; index < Number.MAX_SAFE_INTEGER; index += 1) {
    const candidate = `${prefix}-${index}`;
    if (!ids.has(candidate)) return candidate;
  }
  throw new RangeError("Unable to allocate a bounded joint id");
}

function quaternionConjugate(value) {
  return [-value[0], -value[1], -value[2], value[3]];
}

function rotateVector(quaternion, vectorValue) {
  const [x, y, z, w] = quaternion;
  const [vx, vy, vz] = vectorValue;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

export function rigWorldPointToLocal(documentValue, parentIdValue, pointValue) {
  const document = normalizeRigDocument(documentValue);
  const parentId = optionalString(parentIdValue, "parentId");
  const point = vector(pointValue, [0, 0, 0], 3, "point");
  if (!parentId) return point;
  const parent = rigRestWorldTransforms(document).find((entry) => entry.id === parentId);
  if (!parent) throw new RangeError(`Unknown parent joint: ${parentId}`);
  const relative = point.map((entry, axis) => entry - parent.translation[axis]);
  const unrotated = rotateVector(quaternionConjugate(parent.rotation), relative);
  return unrotated.map((entry, axis) => entry / parent.scale[axis]);
}

export function rigLocalPointToWorld(documentValue, parentIdValue, pointValue) {
  const document = normalizeRigDocument(documentValue);
  const parentId = optionalString(parentIdValue, "parentId");
  const point = vector(pointValue, [0, 0, 0], 3, "point");
  if (!parentId) return point;
  const parent = rigRestWorldTransforms(document).find((entry) => entry.id === parentId);
  if (!parent) throw new RangeError(`Unknown parent joint: ${parentId}`);
  const scaled = point.map((entry, axis) => entry * parent.scale[axis]);
  const rotated = rotateVector(parent.rotation, scaled);
  return rotated.map((entry, axis) => entry + parent.translation[axis]);
}

export function snapRigPoint(pointValue, snapValue = {}) {
  const point = vector(pointValue, [0, 0, 0], 3, "point");
  const snap = normalizeRigSnap(snapValue);
  if (!snap.enabled || snap.mode === "none") return point;
  return point.map((entry) => Math.round(entry / snap.translate) * snap.translate);
}

function replacementPair(id) {
  const pairs = [
    [/\bleft\b/iu, "right"],
    [/\bright\b/iu, "left"],
    [/(^|[-_.\/])l($|[-_.\/])/iu, "$1r$2"],
    [/(^|[-_.\/])r($|[-_.\/])/iu, "$1l$2"],
  ];
  for (const [pattern, replacement] of pairs) {
    if (pattern.test(id)) return id.replace(pattern, replacement);
  }
  return null;
}

export function suggestedMirroredJointId(idValue, axis = "x") {
  const id = requiredString(idValue, "jointId");
  if (!AXES.includes(axis)) throw new TypeError("Mirror axis must be x, y, or z");
  return replacementPair(id) ?? `${id}-mirror-${axis}`;
}

export function buildRigIdMap(documentValue, jointIdsValue, {
  kind = "duplicate",
  axis = "x",
  idFor = null,
} = {}) {
  const document = normalizeRigDocument(documentValue);
  const jointIds = uniqueStrings(jointIdsValue, "jointIds");
  const existing = knownJointIds(document);
  const targets = new Set();
  const idMap = {};
  const collisions = [];
  for (const id of jointIds) {
    if (!existing.has(id)) throw new RangeError(`Unknown joint: ${id}`);
    const proposed = typeof idFor === "function"
      ? requiredString(idFor(id), `idFor(${id})`)
      : kind === "mirror"
        ? suggestedMirroredJointId(id, axis)
        : `${id}-copy`;
    let candidate = proposed;
    let suffix = 2;
    while ((existing.has(candidate) || targets.has(candidate)) && suffix < 10_000) {
      if (kind === "mirror") {
        collisions.push({ source: id, target: proposed, code: "rig/mirror-name-collision" });
        break;
      }
      candidate = `${proposed}-${suffix++}`;
    }
    if (existing.has(candidate) || targets.has(candidate)) {
      collisions.push({ source: id, target: candidate, code: `rig/${kind}-name-collision` });
      continue;
    }
    targets.add(candidate);
    idMap[id] = candidate;
  }
  return { idMap, collisions };
}

export function buildRigEditorIntent(documentValue, editorValue, actionValue = {}) {
  const document = normalizeRigDocument(documentValue);
  const editor = normalizeRigEditor(editorValue, document);
  if (!isPlainObject(actionValue)) throw new TypeError("Rig editor action must be an object");
  const action = clonePortable(actionValue);
  const type = requiredString(action.type, "action.type");
  const base = {
    schema: RIG_INTENT_SCHEMA,
    expectedRevision: document.revision,
  };
  if (action.id !== undefined) base.id = action.id;
  if (action.sequence !== undefined) base.sequence = action.sequence;
  if (type === "create") {
    const parentId = optionalString(
      Object.hasOwn(action, "parentId") ? action.parentId : editor.active,
      "action.parentId",
    );
    const worldPosition = snapRigPoint(action.worldPosition, editor.snap);
    return {
      ...base,
      type: "rig/joint-create",
      joint: {
        id: action.jointId ?? nextRigJointId(document, action.prefix ?? "joint"),
        parent: parentId,
        role: action.role ?? "joint",
        rest: { translation: rigWorldPointToLocal(document, parentId, worldPosition) },
      },
    };
  }
  if (type === "move") {
    const jointId = requiredString(action.jointId ?? editor.active, "action.jointId");
    const joint = document.joints.find((entry) => entry.id === jointId);
    if (!joint) throw new RangeError(`Unknown joint: ${jointId}`);
    const worldPosition = snapRigPoint(action.worldPosition, editor.snap);
    return {
      ...base,
      type: "rig/joint-update",
      jointId,
      patch: { rest: { translation: rigWorldPointToLocal(document, joint.parent, worldPosition) } },
    };
  }
  if (type === "rename") return { ...base, type: "rig/joint-rename", jointId: action.jointId ?? editor.active, nextId: action.nextId };
  if (type === "reparent") return { ...base, type: "rig/joint-reparent", jointId: action.jointId ?? editor.active, parentId: action.parentId ?? null };
  if (type === "delete") return { ...base, type: "rig/joint-delete", jointId: action.jointId ?? editor.active, cascade: Boolean(action.cascade) };
  if (type === "duplicate") {
    const jointIds = action.jointIds ?? editor.selection;
    const { idMap, collisions } = buildRigIdMap(document, jointIds, { kind: "duplicate", idFor: action.idFor });
    if (collisions.length) throw new RangeError(`Duplicate joint naming collision: ${collisions[0].target}`);
    return { ...base, type: "rig/joint-duplicate", jointIds, idMap, offset: action.offset ?? [0.15, 0, 0.15] };
  }
  if (type === "mirror") {
    const jointIds = action.jointIds ?? editor.selection;
    const axis = AXES.includes(action.axis) ? action.axis : "x";
    const { idMap, collisions } = buildRigIdMap(document, jointIds, { kind: "mirror", axis, idFor: action.idFor });
    if (collisions.length) throw new RangeError(`Mirror joint naming collision: ${collisions[0].target}`);
    return { ...base, type: "rig/joint-mirror", jointIds, idMap, axis };
  }
  throw new TypeError(`Unsupported rig editor action: ${type}`);
}

function normalizeSnapshot(value, fallbackDocument) {
  if (!isPlainObject(value)) throw new TypeError("Rig history snapshot must be an object");
  const document = normalizeRigDocument(value.document ?? fallbackDocument);
  return {
    document,
    editor: normalizeRigEditor(value.editor ?? {}, document),
  };
}

function normalizeHistory(value = {}, document) {
  if (!isPlainObject(value)) throw new TypeError("Rig history must be an object");
  const limit = clamp(safeInteger(value.limit, DEFAULT_RIG_HISTORY_LIMIT, "history.limit", 1), 1, MAX_RIG_HISTORY_LIMIT);
  const undoValue = value.undo ?? [];
  const redoValue = value.redo ?? [];
  if (!Array.isArray(undoValue) || !Array.isArray(redoValue)) throw new TypeError("Rig history undo and redo must be arrays");
  const undo = undoValue.slice(-limit).map((entry) => normalizeSnapshot(entry, document));
  const redo = redoValue.slice(-limit).map((entry) => normalizeSnapshot(entry, document));
  return { limit, undo, redo };
}

export function createRigAuthoringState(value = {}) {
  if (!isPlainObject(value)) throw new TypeError("Rig authoring state must be an object");
  clonePortable(value);
  if (value.schema !== undefined && value.schema !== RIG_AUTHORING_SCHEMA) {
    throw new TypeError(`Rig authoring schema must be ${RIG_AUTHORING_SCHEMA}`);
  }
  const document = value.document
    ? normalizeRigDocument(value.document)
    : createRigDocument({ id: value.rigId ?? "rig:untitled", assetId: value.assetId ?? "asset:unassigned" });
  return {
    schema: RIG_AUTHORING_SCHEMA,
    document,
    editor: normalizeRigEditor(value.editor ?? {}, document),
    history: normalizeHistory(value.history ?? {}, document),
    session: value.session === undefined ? null : clonePortable(value.session),
    lastOutcome: value.lastOutcome === undefined ? null : clonePortable(value.lastOutcome),
    lastEvidence: value.lastEvidence === undefined ? null : clonePortable(value.lastEvidence),
  };
}

function historySnapshot(state) {
  return {
    document: clonePortable(state.document),
    editor: clonePortable(state.editor),
  };
}

function normalizeEditorAfter(editor, document, patch = null) {
  if (!patch) return normalizeRigEditor(editor, document);
  if (!isPlainObject(patch)) throw new TypeError("editorAfter must be an object");
  return normalizeRigEditor({ ...editor, ...clonePortable(patch) }, document);
}

export function commitRigAuthoringIntent(stateValue, intentValue, { editorAfter = null } = {}) {
  const state = createRigAuthoringState(stateValue);
  const result = applyRigIntent(state.document, intentValue);
  if (!result.ok) {
    return createRigAuthoringState({
      ...state,
      lastOutcome: result.outcome,
      lastEvidence: result.evidence,
    });
  }
  const history = {
    ...state.history,
    undo: [...state.history.undo, historySnapshot(state)].slice(-state.history.limit),
    redo: [],
  };
  return createRigAuthoringState({
    ...state,
    document: result.document,
    editor: normalizeEditorAfter(state.editor, result.document, editorAfter),
    history,
    lastOutcome: result.outcome,
    lastEvidence: result.evidence,
  });
}

export function undoRigAuthoring(stateValue) {
  const state = createRigAuthoringState(stateValue);
  const snapshot = state.history.undo.at(-1);
  if (!snapshot) return state;
  return createRigAuthoringState({
    ...state,
    document: snapshot.document,
    editor: snapshot.editor,
    history: {
      ...state.history,
      undo: state.history.undo.slice(0, -1),
      redo: [...state.history.redo, historySnapshot(state)].slice(-state.history.limit),
    },
  });
}

export function redoRigAuthoring(stateValue) {
  const state = createRigAuthoringState(stateValue);
  const snapshot = state.history.redo.at(-1);
  if (!snapshot) return state;
  return createRigAuthoringState({
    ...state,
    document: snapshot.document,
    editor: snapshot.editor,
    history: {
      ...state.history,
      undo: [...state.history.undo, historySnapshot(state)].slice(-state.history.limit),
      redo: state.history.redo.slice(0, -1),
    },
  });
}

export function reduceRigAuthoringEvent(stateValue, eventValue = {}) {
  const state = createRigAuthoringState(stateValue);
  if (!isPlainObject(eventValue)) throw new TypeError("Rig authoring event must be an object");
  const event = clonePortable(eventValue);
  const type = requiredString(event["event/type"] ?? event.type, "event/type");
  if (type === "rig/intent") {
    return commitRigAuthoringIntent(state, event.intent, { editorAfter: event.editorAfter ?? null });
  }
  if (["rig/history-undo", "studio/history-undo", "world/history-undo"].includes(type)) return undoRigAuthoring(state);
  if (["rig/history-redo", "studio/history-redo", "world/history-redo"].includes(type)) return redoRigAuthoring(state);
  if (type === "rig/editor-select") {
    const incoming = event.jointIds ?? (event.jointId ? [event.jointId] : []);
    return createRigAuthoringState({
      ...state,
      editor: selectRigJoints(state.editor, incoming, event.mode ?? "replace", state.document),
    });
  }
  if (type === "rig/editor-settings") {
    return createRigAuthoringState({
      ...state,
      editor: normalizeRigEditor({ ...state.editor, ...event.patch }, state.document),
    });
  }
  if (type === "rig/editor-toggle-expanded") {
    return createRigAuthoringState({
      ...state,
      editor: toggleRigJointExpanded(state.editor, event.jointId, state.document),
    });
  }
  if (type === "rig/editor-focus") {
    return createRigAuthoringState({
      ...state,
      editor: normalizeRigEditor({ ...state.editor, focused: event.jointId }, state.document),
    });
  }
  if (type === "rig/authoring-replace") {
    const document = normalizeRigDocument(event.document);
    const sourceContentId = optionalString(event.sourceContentId, "event.sourceContentId");
    const activeContentId = optionalString(state.session?.active?.source?.contentId, "state.session.active.source.contentId");
    if (!sourceContentId || sourceContentId !== document.assetId) {
      throw new RangeError("Replacement rig source identity must match document.assetId");
    }
    if (!activeContentId || activeContentId !== sourceContentId) {
      throw new RangeError("Replacement rig source identity must match the active local source");
    }
    const historyLimit = safeInteger(event.history?.limit, state.history.limit, "event.history.limit", 1);
    if (historyLimit > MAX_RIG_HISTORY_LIMIT) throw new RangeError(`event.history.limit cannot exceed ${MAX_RIG_HISTORY_LIMIT}`);
    return createRigAuthoringState({
      ...state,
      document,
      editor: normalizeRigEditor(event.editor ?? {}, document),
      history: { limit: historyLimit, undo: [], redo: [] },
      lastOutcome: {
        schema: RIG_OUTCOME_SCHEMA,
        operationId: optionalString(event.operationId, "event.operationId") ?? "rig/workfile-restore",
        type: requiredString(event.reason ?? "rig/authoring-replace", "event.reason"),
        status: "applied",
        revisionBefore: state.document.revision,
        revisionAfter: document.revision,
        sourcePolicy: optionalString(event.sourcePolicy, "event.sourcePolicy"),
      },
      lastEvidence: null,
    });
  }
  if (type === "rig/source-opened") {
    const session = clonePortable(event.session);
    const sourceId = session?.active?.source?.contentId ?? null;
    const preserve = event.preserveDocument === true || !sourceId || state.document.assetId === sourceId;
    const document = preserve
      ? state.document
      : ensureRigRoot(createRigDocument({ id: event.rigId ?? `rig:${sourceId}`, assetId: sourceId }));
    return createRigAuthoringState({
      ...state,
      session,
      document,
      editor: preserve ? state.editor : {},
      history: preserve ? state.history : { limit: state.history.limit, undo: [], redo: [] },
    });
  }
  throw new TypeError(`Unsupported rig authoring event: ${type}`);
}

export function previewRigJoint(documentValue, jointIdValue, worldPositionValue) {
  const document = normalizeRigDocument(documentValue);
  const jointId = requiredString(jointIdValue, "jointId");
  const joint = document.joints.find((entry) => entry.id === jointId);
  if (!joint) throw new RangeError(`Unknown joint: ${jointId}`);
  const worldPosition = vector(worldPositionValue, [0, 0, 0], 3, "worldPosition");
  const joints = document.joints.map((entry) => entry.id === jointId
    ? { ...entry, rest: { ...entry.rest, translation: rigWorldPointToLocal(document, entry.parent, worldPosition) } }
    : entry);
  return normalizeRigDocument({ ...document, joints });
}

export function ensureRigRoot(documentValue, { id = "root", role = "root", translation = [0, 0, 0] } = {}) {
  const document = normalizeRigDocument(documentValue);
  if (document.joints.length) return document;
  return addRigJoint(document, { id, parent: null, role, rest: { translation } });
}
