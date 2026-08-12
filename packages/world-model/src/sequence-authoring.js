import { normalizeCharacterProfile } from "./character-model.js";
import {
  DEFAULT_SEQUENCE_OPERATIONS,
  normalizeSequence,
  normalizeSequenceOperationRegistry,
  sequenceCueDependencies,
  validateSequence,
} from "./sequence-model.js";
import {
  applySequenceEvent,
  openSequence,
  seekSequence,
  tickSequence,
} from "./sequence-runtime.js";
import {
  clonePortable,
  isPlainObject,
  issue,
  requiredString,
  safeInteger,
  validationResult,
} from "./model-values.js";

export const SEQUENCE_AUTHORING_SCHEMA = "hodos.sequence-authoring/0-alpha";
export const SEQUENCE_AUTHORING_COMMANDS = Object.freeze([
  "sequence/replace",
  "sequence/update",
  "sequence/actor-upsert",
  "sequence/actor-delete",
  "sequence/mark-upsert",
  "sequence/mark-delete",
  "sequence/cue-insert",
  "sequence/cue-update",
  "sequence/cue-delete",
  "sequence/cue-reorder",
  "sequence/cue-group",
  "selection/set",
  "timeline/seek",
  "history/undo",
  "history/redo",
]);
export const SEQUENCE_TIMELINE_TRACK_KINDS = Object.freeze([
  "character",
  "camera",
  "dialogue",
  "audio",
  "world",
  "workflow",
  "sequence",
]);

const DEFAULT_MAX_HISTORY = 128;
const MAX_HISTORY = 1_024;
const MAX_SELECTION = 512;

function canonicalPortable(value) {
  if (Array.isArray(value)) return value.map(canonicalPortable);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalPortable(value[key])]),
    );
  }
  return value;
}

function normalizedCharacters(value = {}) {
  if (!isPlainObject(value)) throw new TypeError("Sequence authoring characters must be an object");
  const output = {};
  for (const key of Object.keys(value).sort()) {
    const profile = normalizeCharacterProfile(value[key], `Sequence authoring character ${key}`);
    if (key !== profile.id) throw new Error(`Character key ${key} does not match profile id ${profile.id}`);
    output[key] = profile;
  }
  return output;
}

function normalizeConfiguration(value = {}) {
  if (!isPlainObject(value)) throw new TypeError("Sequence authoring configuration must be an object");
  const maxHistory = safeInteger(
    value.maxHistory,
    DEFAULT_MAX_HISTORY,
    "Sequence authoring maxHistory",
    1,
  );
  if (maxHistory > MAX_HISTORY) {
    throw new TypeError(`Sequence authoring maxHistory must be no greater than ${MAX_HISTORY}`);
  }
  return {
    maxHistory,
    operations: normalizeSequenceOperationRegistry(value.operations ?? DEFAULT_SEQUENCE_OPERATIONS),
    characters: normalizedCharacters(value.characters ?? {}),
  };
}

function normalizedSelection(value, sequence) {
  if (!Array.isArray(value)) throw new TypeError("Sequence authoring selection must be an array");
  if (value.length > MAX_SELECTION) throw new Error(`Sequence authoring selection exceeds ${MAX_SELECTION} cues`);
  const cueIds = new Set(sequence.cues.map(({ id }) => id));
  const output = [];
  const seen = new Set();
  value.forEach((entry, index) => {
    const id = requiredString(entry, `Sequence authoring selection[${index}]`);
    if (!cueIds.has(id)) throw new Error(`Sequence authoring selection references missing cue ${id}`);
    if (!seen.has(id)) {
      seen.add(id);
      output.push(id);
    }
  });
  return output;
}

function stateDiagnostics(sequence, configuration) {
  return diagnoseSequenceBindings(sequence, configuration);
}

export function openSequenceAuthoring(sequenceValue, configurationValue = {}) {
  const configuration = normalizeConfiguration(configurationValue);
  const sequence = normalizeSequence(sequenceValue, { operations: configuration.operations });
  return {
    schema: SEQUENCE_AUTHORING_SCHEMA,
    revision: 0,
    sequence,
    selection: [],
    cursor: 0,
    past: [],
    future: [],
    diagnostics: stateDiagnostics(sequence, configuration),
    configuration,
  };
}

export function normalizeSequenceAuthoringState(value) {
  const state = clonePortable(value);
  if (!isPlainObject(state) || state.schema !== SEQUENCE_AUTHORING_SCHEMA) {
    throw new TypeError("Sequence authoring requires a hodos.sequence-authoring/0-alpha value");
  }
  const configuration = normalizeConfiguration(state.configuration ?? {});
  const sequence = normalizeSequence(state.sequence, { operations: configuration.operations });
  const past = Array.isArray(state.past) ? state.past.slice(-configuration.maxHistory) : [];
  const future = Array.isArray(state.future) ? state.future.slice(0, configuration.maxHistory) : [];
  return {
    schema: SEQUENCE_AUTHORING_SCHEMA,
    revision: safeInteger(state.revision, 0, "Sequence authoring revision"),
    sequence,
    selection: normalizedSelection(state.selection ?? [], sequence),
    cursor: Math.max(0, Number.isFinite(state.cursor) ? state.cursor : 0),
    past: past.map((entry, index) => normalizeHistoryEntry(entry, configuration, `past[${index}]`)),
    future: future.map((entry, index) => normalizeHistoryEntry(entry, configuration, `future[${index}]`)),
    diagnostics: stateDiagnostics(sequence, configuration),
    configuration,
  };
}

function normalizeHistoryEntry(value, configuration, path) {
  if (!isPlainObject(value)) throw new TypeError(`Sequence authoring ${path} must be an object`);
  return {
    label: requiredString(value.label ?? "Edit sequence", `Sequence authoring ${path}.label`),
    command: requiredString(value.command ?? "sequence/replace", `Sequence authoring ${path}.command`),
    sequence: normalizeSequence(value.sequence, { operations: configuration.operations }),
  };
}

function historyEntry(state, label, command) {
  return {
    label,
    command,
    sequence: clonePortable(state.sequence),
  };
}

function commitSequence(stateValue, sequenceValue, { label, command }) {
  const state = normalizeSequenceAuthoringState(stateValue);
  const sequence = normalizeSequence(sequenceValue, { operations: state.configuration.operations });
  const past = [
    ...state.past,
    historyEntry(state, label, command),
  ].slice(-state.configuration.maxHistory);
  return {
    ...state,
    revision: state.revision + 1,
    sequence,
    selection: state.selection.filter((id) => sequence.cues.some((cue) => cue.id === id)),
    past,
    future: [],
    diagnostics: stateDiagnostics(sequence, state.configuration),
  };
}

function undo(stateValue) {
  const state = normalizeSequenceAuthoringState(stateValue);
  const entry = state.past.at(-1);
  if (!entry) return state;
  return {
    ...state,
    revision: state.revision + 1,
    sequence: clonePortable(entry.sequence),
    selection: state.selection.filter((id) => entry.sequence.cues.some((cue) => cue.id === id)),
    past: state.past.slice(0, -1),
    future: [historyEntry(state, entry.label, entry.command), ...state.future]
      .slice(0, state.configuration.maxHistory),
    diagnostics: stateDiagnostics(entry.sequence, state.configuration),
  };
}

function redo(stateValue) {
  const state = normalizeSequenceAuthoringState(stateValue);
  const entry = state.future[0];
  if (!entry) return state;
  return {
    ...state,
    revision: state.revision + 1,
    sequence: clonePortable(entry.sequence),
    selection: state.selection.filter((id) => entry.sequence.cues.some((cue) => cue.id === id)),
    past: [...state.past, historyEntry(state, entry.label, entry.command)]
      .slice(-state.configuration.maxHistory),
    future: state.future.slice(1),
    diagnostics: stateDiagnostics(entry.sequence, state.configuration),
  };
}

function cueIndex(sequence, cueId) {
  const index = sequence.cues.findIndex(({ id }) => id === cueId);
  if (index < 0) throw new Error(`Unknown sequence cue: ${cueId}`);
  return index;
}

function dependencyClosure(sequence, roots) {
  const selected = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const cue of sequence.cues) {
      if (!selected.has(cue.id) && sequenceCueDependencies(cue).some((id) => selected.has(id))) {
        selected.add(cue.id);
        changed = true;
      }
    }
  }
  return selected;
}

function mergeCue(cue, patch) {
  if (!isPlainObject(patch)) throw new TypeError("Sequence cue patch must be an object");
  const output = { ...clonePortable(cue), ...clonePortable(patch) };
  for (const key of ["action", "start", "metadata", "when", "complete"]) {
    if (isPlainObject(cue[key]) && isPlainObject(patch[key])) {
      output[key] = { ...clonePortable(cue[key]), ...clonePortable(patch[key]) };
    }
  }
  return output;
}

function editSequence(sequenceValue, command) {
  const sequence = clonePortable(sequenceValue);
  const type = requiredString(command.type, "Sequence authoring command type");

  if (type === "sequence/replace") return clonePortable(command.sequence);
  if (type === "sequence/update") {
    const patch = clonePortable(command.patch ?? {});
    if (!isPlainObject(patch)) throw new TypeError("sequence/update patch must be an object");
    return { ...sequence, ...patch };
  }
  if (type === "sequence/actor-upsert") {
    const id = requiredString(command.actorId ?? command.actor?.id, "Sequence actor id");
    const actor = clonePortable(command.actor ?? {});
    return { ...sequence, actors: { ...sequence.actors, [id]: actor } };
  }
  if (type === "sequence/actor-delete") {
    const id = requiredString(command.actorId, "Sequence actor id");
    if (!sequence.actors[id]) return sequence;
    const targeted = sequence.cues.filter(({ target }) => target === id).map(({ id: cueId }) => cueId);
    if (targeted.length && command.cascade !== true) {
      throw new Error(`Actor ${id} is targeted by cues: ${targeted.join(", ")}`);
    }
    const deleted = command.cascade === true ? dependencyClosure(sequence, targeted) : new Set();
    const actors = { ...sequence.actors };
    delete actors[id];
    return { ...sequence, actors, cues: sequence.cues.filter(({ id: cueId }) => !deleted.has(cueId)) };
  }
  if (type === "sequence/mark-upsert") {
    const id = requiredString(command.markId ?? command.mark?.id, "Sequence mark id");
    const mark = clonePortable(command.mark ?? {});
    return { ...sequence, marks: { ...sequence.marks, [id]: mark } };
  }
  if (type === "sequence/mark-delete") {
    const id = requiredString(command.markId, "Sequence mark id");
    if (!sequence.marks[id]) return sequence;
    const referenced = sequence.cues.filter((cue) => (
      cue.action?.mark === id || (cue.action?.op === "character/look-at" && cue.action?.target === id)
    )).map(({ id: cueId }) => cueId);
    if (referenced.length && command.cascade !== true) {
      throw new Error(`Scene mark ${id} is referenced by cues: ${referenced.join(", ")}`);
    }
    const deleted = command.cascade === true ? dependencyClosure(sequence, referenced) : new Set();
    const marks = { ...sequence.marks };
    delete marks[id];
    return { ...sequence, marks, cues: sequence.cues.filter(({ id: cueId }) => !deleted.has(cueId)) };
  }
  if (type === "sequence/cue-insert") {
    const cue = clonePortable(command.cue);
    if (!isPlainObject(cue)) throw new TypeError("sequence/cue-insert requires a cue object");
    const id = requiredString(cue.id, "Inserted sequence cue id");
    if (sequence.cues.some(({ id: candidate }) => candidate === id)) {
      throw new Error(`Sequence cue already exists: ${id}`);
    }
    let index = sequence.cues.length;
    if (command.afterCueId !== undefined && command.afterCueId !== null) {
      index = cueIndex(sequence, requiredString(command.afterCueId, "Sequence afterCueId")) + 1;
    } else if (command.index !== undefined) {
      index = Math.max(0, Math.min(sequence.cues.length, safeInteger(command.index, 0, "Sequence cue index")));
    }
    return { ...sequence, cues: [...sequence.cues.slice(0, index), cue, ...sequence.cues.slice(index)] };
  }
  if (type === "sequence/cue-update") {
    const id = requiredString(command.cueId, "Sequence cue id");
    const index = cueIndex(sequence, id);
    const cues = [...sequence.cues];
    cues[index] = mergeCue(cues[index], command.patch ?? {});
    if (cues[index].id !== id && sequence.cues.some((cue, cuePosition) => cuePosition !== index && cue.id === cues[index].id)) {
      throw new Error(`Sequence cue already exists: ${cues[index].id}`);
    }
    return { ...sequence, cues };
  }
  if (type === "sequence/cue-delete") {
    const id = requiredString(command.cueId, "Sequence cue id");
    cueIndex(sequence, id);
    const deleted = command.cascade === true ? dependencyClosure(sequence, [id]) : new Set([id]);
    const dependents = sequence.cues.filter((cue) => (
      !deleted.has(cue.id) && sequenceCueDependencies(cue).some((dependency) => deleted.has(dependency))
    ));
    if (dependents.length) {
      throw new Error(`Cue ${id} is required by cues: ${dependents.map(({ id: cueId }) => cueId).join(", ")}`);
    }
    return { ...sequence, cues: sequence.cues.filter(({ id: cueId }) => !deleted.has(cueId)) };
  }
  if (type === "sequence/cue-reorder") {
    if (!Array.isArray(command.cueIds)) throw new TypeError("sequence/cue-reorder requires cueIds");
    const ids = command.cueIds.map((id, index) => requiredString(id, `Sequence cueIds[${index}]`));
    const current = sequence.cues.map(({ id }) => id);
    if (new Set(ids).size !== ids.length || ids.length !== current.length || current.some((id) => !ids.includes(id))) {
      throw new Error("sequence/cue-reorder must contain every cue id exactly once");
    }
    const byId = new Map(sequence.cues.map((cue) => [cue.id, cue]));
    return { ...sequence, cues: ids.map((id) => byId.get(id)) };
  }
  if (type === "sequence/cue-group") {
    const groupId = requiredString(command.groupId, "Sequence cue group id");
    if (!Array.isArray(command.cueIds) || !command.cueIds.length) {
      throw new TypeError("sequence/cue-group requires one or more cueIds");
    }
    const selected = new Set(command.cueIds.map((id) => requiredString(id, "Sequence grouped cue id")));
    for (const id of selected) cueIndex(sequence, id);
    return {
      ...sequence,
      cues: sequence.cues.map((cue) => selected.has(cue.id)
        ? { ...cue, metadata: { ...cue.metadata, group: groupId } }
        : cue),
    };
  }
  throw new Error(`Unsupported sequence authoring command: ${type}`);
}

export function applySequenceAuthoringCommand(stateValue, commandValue) {
  const state = normalizeSequenceAuthoringState(stateValue);
  if (!isPlainObject(commandValue)) throw new TypeError("Sequence authoring command must be an object");
  const type = requiredString(commandValue.type, "Sequence authoring command type");
  if (!SEQUENCE_AUTHORING_COMMANDS.includes(type)) {
    throw new Error(`Unsupported sequence authoring command: ${type}`);
  }
  if (type === "history/undo") return undo(state);
  if (type === "history/redo") return redo(state);
  if (type === "selection/set") {
    return { ...state, selection: normalizedSelection(commandValue.cueIds ?? [], state.sequence) };
  }
  if (type === "timeline/seek") {
    const time = Number(commandValue.time);
    if (!Number.isFinite(time) || time < 0) throw new TypeError("Timeline time must be a non-negative finite number");
    return { ...state, cursor: time };
  }
  const next = editSequence(state.sequence, commandValue);
  return commitSequence(state, next, {
    label: requiredString(commandValue.label ?? type, "Sequence authoring command label"),
    command: type,
  });
}

function cueDuration(cue) {
  for (const candidate of [cue.metadata?.duration, cue.action?.duration, cue.action?.seconds]) {
    if (Number.isFinite(candidate) && candidate >= 0) return candidate;
  }
  return 0;
}

function nominalCueTimes(sequence) {
  const byId = new Map(sequence.cues.map((cue) => [cue.id, cue]));
  const times = new Map();
  const resolve = (id, visiting = new Set()) => {
    if (times.has(id)) return times.get(id);
    if (visiting.has(id)) return 0;
    const cue = byId.get(id);
    if (!cue) return 0;
    visiting.add(id);
    let time = 0;
    if (cue.start.type === "at") time = cue.start.at;
    else if (cue.start.type === "with" || cue.start.type === "marker") time = resolve(cue.start.cue, visiting);
    else if (cue.start.type === "after") {
      const dependency = byId.get(cue.start.cue);
      time = resolve(cue.start.cue, visiting) + (dependency ? cueDuration(dependency) : 0);
    } else {
      const candidates = cue.start.cues.map((dependency) => {
        const dependentCue = byId.get(dependency);
        return resolve(dependency, visiting) + (dependentCue ? cueDuration(dependentCue) : 0);
      });
      time = cue.start.type === "any" ? Math.min(...candidates) : Math.max(...candidates);
    }
    visiting.delete(id);
    times.set(id, time);
    return time;
  };
  for (const cue of sequence.cues) resolve(cue.id);
  return times;
}

function trackDescriptor(cue) {
  const operation = cue.action.op;
  if (operation === "character/say") {
    return { id: `dialogue:${cue.target ?? "global"}`, kind: "dialogue", target: cue.target };
  }
  if (operation.startsWith("character/")) {
    return { id: `character:${cue.target ?? "unbound"}`, kind: "character", target: cue.target };
  }
  if (operation.startsWith("camera/")) return { id: "camera", kind: "camera", target: null };
  if (operation.startsWith("audio/")) return { id: "audio", kind: "audio", target: null };
  if (operation.startsWith("workflow/")) return { id: "workflow", kind: "workflow", target: null };
  if (operation.startsWith("sequence/")) return { id: "sequence", kind: "sequence", target: null };
  return { id: "world", kind: "world", target: cue.target };
}

export function projectSequenceTimeline(sequenceValue, configurationValue = {}) {
  const operations = normalizeSequenceOperationRegistry(configurationValue.operations ?? DEFAULT_SEQUENCE_OPERATIONS);
  const sequence = normalizeSequence(sequenceValue, { operations });
  const times = nominalCueTimes(sequence);
  const tracks = new Map();
  sequence.cues.forEach((cue, index) => {
    const descriptor = trackDescriptor(cue);
    if (!tracks.has(descriptor.id)) tracks.set(descriptor.id, { ...descriptor, cues: [] });
    const start = times.get(cue.id) ?? 0;
    const duration = cueDuration(cue);
    tracks.get(descriptor.id).cues.push({
      id: cue.id,
      index,
      operation: cue.action.op,
      target: cue.target,
      start,
      duration,
      end: start + duration,
      startCondition: clonePortable(cue.start),
      branch: clonePortable(cue.when),
      timeout: cue.timeout,
      onTimeout: cue.onTimeout,
      group: cue.metadata?.group ?? null,
      action: clonePortable(cue.action),
    });
  });
  const kindOrder = new Map(SEQUENCE_TIMELINE_TRACK_KINDS.map((kind, index) => [kind, index]));
  return [...tracks.values()]
    .map((track) => ({ ...track, cues: track.cues.sort((left, right) => left.start - right.start || left.index - right.index) }))
    .sort((left, right) => (
      kindOrder.get(left.kind) - kindOrder.get(right.kind) || left.id.localeCompare(right.id)
    ));
}

export function diagnoseSequenceBindings(sequenceValue, configurationValue = {}) {
  const operations = normalizeSequenceOperationRegistry(configurationValue.operations ?? DEFAULT_SEQUENCE_OPERATIONS);
  const characters = normalizedCharacters(configurationValue.characters ?? {});
  const validation = validateSequence(sequenceValue, { operations });
  if (!validation.valid) return validation;
  const sequence = normalizeSequence(sequenceValue, { operations });
  const warnings = [...validation.warnings];
  const errors = [...validation.errors];

  for (const [actorId, actor] of Object.entries(sequence.actors)) {
    if (!actor.characterId) {
      warnings.push(issue("actor/unbound-character", `$.actors.${actorId}.characterId`, `Actor ${actorId} has no character profile binding`, "warning"));
    } else if (!characters[actor.characterId]) {
      warnings.push(issue("actor/missing-character", `$.actors.${actorId}.characterId`, `Character profile ${actor.characterId} is not available`, "warning"));
    }
  }

  sequence.cues.forEach((cue, index) => {
    const actor = cue.target ? sequence.actors[cue.target] : null;
    const profile = actor?.characterId ? characters[actor.characterId] : null;
    const clipId = cue.action.clip ?? cue.action.locomotion ?? cue.action.gesture;
    if (clipId && profile && !profile.clips[clipId]) {
      errors.push(issue("cue/missing-clip", `$.cues[${index}].action`, `Cue ${cue.id} references missing clip ${clipId} on ${profile.id}`));
    }
    const operation = operations[cue.action.op];
    if (actor && operation?.capabilities?.length) {
      const available = new Set([...(actor.capabilities ?? []), ...(profile?.capabilities ?? [])]);
      const missing = operation.capabilities.filter((capability) => !available.has(capability));
      if (missing.length) {
        warnings.push(issue(
          "cue/missing-capability",
          `$.cues[${index}].action.op`,
          `Cue ${cue.id} may require unavailable capabilities: ${missing.join(", ")}`,
          "warning",
        ));
      }
    }
  });
  return validationResult(errors, warnings);
}

export function canonicalSequenceJson(sequenceValue, configurationValue = {}, space = 2) {
  const operations = normalizeSequenceOperationRegistry(configurationValue.operations ?? DEFAULT_SEQUENCE_OPERATIONS);
  return JSON.stringify(canonicalPortable(normalizeSequence(sequenceValue, { operations })), null, space);
}

export function parseCanonicalSequenceJson(source, configurationValue = {}) {
  if (typeof source !== "string") throw new TypeError("Canonical sequence JSON source must be a string");
  return normalizeSequence(JSON.parse(source), {
    operations: configurationValue.operations ?? DEFAULT_SEQUENCE_OPERATIONS,
  });
}

export function createSequenceAuthoringPreviewOperations(value = DEFAULT_SEQUENCE_OPERATIONS) {
  const operations = normalizeSequenceOperationRegistry(value);
  return Object.fromEntries(Object.entries(operations).map(([id, operation]) => [id, {
    ...operation,
    previewSafe: true,
    reversible: true,
    metadata: { ...operation.metadata, authoringPreviewOnly: true },
  }]));
}

export function openSequenceAuthoringPreview(stateValue, bindings = {}) {
  const state = normalizeSequenceAuthoringState(stateValue);
  return openSequence(state.sequence, bindings, {
    operations: createSequenceAuthoringPreviewOperations(state.configuration.operations),
    preview: true,
  });
}

export function seekSequenceAuthoringPreview(stateValue, logicalTime, bindings = {}) {
  const state = normalizeSequenceAuthoringState(stateValue);
  return seekSequence(state.sequence, logicalTime, bindings, {
    operations: createSequenceAuthoringPreviewOperations(state.configuration.operations),
  });
}

export function tickSequenceAuthoringPreview(runtimeState, logicalTime) {
  return tickSequence(runtimeState, logicalTime);
}

export function applySequenceAuthoringPreviewEvent(runtimeState, event) {
  return applySequenceEvent(runtimeState, event);
}

export function sequenceAuthoringSnapshot(stateValue) {
  const state = normalizeSequenceAuthoringState(stateValue);
  return {
    schema: state.schema,
    revision: state.revision,
    sequence: clonePortable(state.sequence),
    selection: [...state.selection],
    cursor: state.cursor,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    diagnostics: clonePortable(state.diagnostics),
    tracks: projectSequenceTimeline(state.sequence, state.configuration),
    canonicalJson: canonicalSequenceJson(state.sequence, state.configuration),
  };
}
