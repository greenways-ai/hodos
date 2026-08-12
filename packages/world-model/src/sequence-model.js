import {
  clonePortable,
  finiteNumber,
  isPlainObject,
  issue,
  optionalString,
  requiredString,
  safeInteger,
  uniqueStrings,
  validationResult,
  vector,
} from "./model-values.js";

export const SEQUENCE_SCHEMA = "hodos.sequence/0-alpha";
export const SEQUENCE_STATE_SCHEMA = "hodos.sequence-state/0-alpha";
export const SEQUENCE_TRACE_SCHEMA = "hodos.sequence-trace/0-alpha";
export const SEQUENCE_CUE_STATUSES = Object.freeze([
  "pending", "active", "completed", "failed", "cancelled", "skipped",
]);
export const SEQUENCE_STATUSES = Object.freeze([
  "running", "completed", "failed", "cancelled",
]);
export const SEQUENCE_EVENT_TYPES = Object.freeze([
  "sequence/marker",
  "sequence/cue-complete",
  "sequence/cue-failed",
  "sequence/variable-set",
  "sequence/choice",
  "sequence/cancel",
]);

const START_TYPES = Object.freeze(["at", "after", "with", "any", "all", "marker"]);
const COMPLETION_MODES = Object.freeze(["immediate", "marker", "external"]);
const TIMEOUT_POLICIES = Object.freeze(["fail", "complete", "cancel", "skip"]);
const TARGET_TYPES = Object.freeze(["actor", "scene", "none"]);
const MAX_SEQUENCE_OPERATIONS = 512;
const MAX_SEQUENCE_ACTORS = 256;
const MAX_SEQUENCE_MARKS = 2_048;
const MAX_SEQUENCE_CUES = 4_096;

const RAW_DEFAULT_OPERATIONS = [
  ["character/place", "actor", "immediate", null, true, true, ["character.place"]],
  ["character/move-to", "actor", "marker", "arrived", false, true, ["character.navigation", "character.animation"]],
  ["character/turn-to", "actor", "marker", "turned", false, true, ["character.animation"]],
  ["character/play-clip", "actor", "marker", "clip-complete", true, true, ["character.animation"]],
  ["character/blend-clip", "actor", "marker", "clip-complete", true, true, ["character.animation"]],
  ["character/look-at", "actor", "marker", "look-complete", true, true, ["character.look-at"]],
  ["character/gesture", "actor", "marker", "gesture-complete", true, true, ["character.animation"]],
  ["character/say", "actor", "marker", "line-finished", false, false, ["character.dialogue", "audio.play"]],
  ["camera/cut-to", "none", "immediate", null, true, true, ["camera.control"]],
  ["camera/blend-to", "none", "marker", "camera-complete", true, true, ["camera.control"]],
  ["audio/play", "none", "marker", "audio-finished", false, false, ["audio.play"]],
  ["world/emit", "scene", "immediate", null, false, false, ["world.events"]],
  ["workflow/start", "none", "external", null, false, false, ["workflow.start"]],
  ["workflow/await", "none", "external", null, false, false, ["workflow.await"]],
  ["sequence/barrier", "none", "immediate", null, true, true, []],
  ["sequence/set-variable", "none", "immediate", null, true, true, []],
  ["sequence/choose", "none", "external", null, false, true, []],
];

function normalizeCompletion(value, path) {
  const input = typeof value === "string" ? { mode: value } : clonePortable(value ?? { mode: "immediate" });
  if (!isPlainObject(input)) throw new TypeError(`${path} must be a string or object`);
  const mode = requiredString(input.mode ?? (input.marker ? "marker" : "immediate"), `${path}.mode`);
  if (!COMPLETION_MODES.includes(mode)) throw new Error(`${path}.mode has unsupported value: ${mode}`);
  const marker = mode === "marker" ? requiredString(input.marker, `${path}.marker`) : null;
  return { mode, marker };
}

function normalizeOperation(value, idHint, path) {
  const input = clonePortable(value);
  if (!isPlainObject(input)) throw new TypeError(`${path} must be an object`);
  const id = requiredString(input.id ?? idHint, `${path}.id`);
  const target = requiredString(input.target ?? "none", `${path}.target`);
  if (!TARGET_TYPES.includes(target)) throw new Error(`${path}.target has unsupported value: ${target}`);
  return {
    id,
    target,
    completion: normalizeCompletion(input.completion, `${path}.completion`),
    hostEffect: input.hostEffect !== false,
    previewSafe: input.previewSafe === true,
    reversible: input.reversible === true,
    capabilities: uniqueStrings(input.capabilities ?? [], `${path}.capabilities`).sort(),
    metadata: clonePortable(input.metadata ?? {}),
  };
}

function defaultOperationEntries() {
  return RAW_DEFAULT_OPERATIONS.map(([
    id, target, mode, marker, previewSafe, reversible, capabilities,
  ]) => [id, {
    id,
    target,
    completion: { mode, marker },
    hostEffect: !id.startsWith("sequence/") || id === "sequence/choose",
    previewSafe,
    reversible,
    capabilities,
    metadata: {},
  }]);
}

export const DEFAULT_SEQUENCE_OPERATIONS = Object.freeze(Object.fromEntries(defaultOperationEntries()));

export function normalizeSequenceOperationRegistry(value = DEFAULT_SEQUENCE_OPERATIONS) {
  const portable = clonePortable(value);
  if (!Array.isArray(portable) && !isPlainObject(portable)) {
    throw new TypeError("Sequence operations must be an array or object");
  }
  const entries = Array.isArray(portable)
    ? portable.map((entry, index) => [entry?.id, normalizeOperation(entry, entry?.id, `operations[${index}]`)])
    : Object.entries(portable).map(([id, entry]) => [id, normalizeOperation(entry, id, `operations.${id}`)]);
  if (entries.length > MAX_SEQUENCE_OPERATIONS) {
    throw new Error(`Sequence operations exceed the bounded limit of ${MAX_SEQUENCE_OPERATIONS}`);
  }
  const output = {};
  for (const [hint, operation] of entries.sort((left, right) => String(left[0]).localeCompare(String(right[0])))) {
    if (hint && hint !== operation.id) throw new Error(`Operation key ${hint} does not match id ${operation.id}`);
    if (output[operation.id]) throw new Error(`Duplicate sequence operation: ${operation.id}`);
    output[operation.id] = operation;
  }
  return output;
}

function normalizeActor(value, id, path) {
  const input = clonePortable(value ?? {});
  if (!isPlainObject(input)) throw new TypeError(`${path} must be an object`);
  return {
    id,
    entityId: optionalString(input.entityId ?? input["entity/id"], `${path}.entityId`),
    characterId: optionalString(input.characterId ?? input["character/id"], `${path}.characterId`),
    capabilities: uniqueStrings(input.capabilities ?? [], `${path}.capabilities`).sort(),
    metadata: clonePortable(input.metadata ?? {}),
  };
}

function normalizeMark(value, id, path) {
  const input = clonePortable(value ?? {});
  if (!isPlainObject(input)) throw new TypeError(`${path} must be an object`);
  return {
    id,
    position: vector(input.position, [0, 0, 0], 3, `${path}.position`),
    rotation: vector(input.rotation ?? input.facing, [0, 0, 0], 3, `${path}.rotation`),
    metadata: clonePortable(input.metadata ?? {}),
  };
}

function normalizeStart(value, path) {
  if (value === undefined || value === null) return { type: "at", at: 0 };
  if (typeof value === "number") return { type: "at", at: Math.max(0, finiteNumber(value, 0, path)) };
  const input = clonePortable(value);
  if (!isPlainObject(input)) throw new TypeError(`${path} must be a number or object`);
  if (input.type !== undefined) {
    const type = requiredString(input.type, `${path}.type`);
    if (!START_TYPES.includes(type)) throw new Error(`${path}.type has unsupported value: ${type}`);
    if (type === "at") return { type, at: Math.max(0, finiteNumber(input.at, 0, `${path}.at`)) };
    if (type === "after" || type === "with") {
      return { type, cue: requiredString(input.cue, `${path}.cue`) };
    }
    if (type === "any" || type === "all") {
      const cues = uniqueStrings(input.cues, `${path}.cues`);
      if (!cues.length) throw new Error(`${path}.cues requires at least one cue`);
      return { type, cues };
    }
    return {
      type,
      cue: requiredString(input.cue, `${path}.cue`),
      marker: requiredString(input.marker, `${path}.marker`),
    };
  }
  const present = START_TYPES.filter((key) => input[key] !== undefined);
  if (present.length !== 1) throw new Error(`${path} must define exactly one of ${START_TYPES.join(", ")}`);
  const type = present[0];
  if (type === "at") return { type, at: Math.max(0, finiteNumber(input.at, 0, `${path}.at`)) };
  if (type === "after" || type === "with") {
    return { type, cue: requiredString(input[type], `${path}.${type}`) };
  }
  if (type === "any" || type === "all") {
    const cues = uniqueStrings(input[type], `${path}.${type}`);
    if (!cues.length) throw new Error(`${path}.${type} requires at least one cue`);
    return { type, cues };
  }
  const marker = clonePortable(input.marker);
  if (!isPlainObject(marker)) throw new TypeError(`${path}.marker must be an object`);
  return {
    type,
    cue: requiredString(marker.cue, `${path}.marker.cue`),
    marker: requiredString(marker.name ?? marker.marker, `${path}.marker.name`),
  };
}

function normalizeCondition(value, path) {
  if (value === undefined || value === null) return null;
  const input = clonePortable(value);
  if (!isPlainObject(input)) throw new TypeError(`${path} must be an object`);
  const hasEquals = Object.hasOwn(input, "equals");
  const hasIn = Object.hasOwn(input, "in");
  if (hasEquals === hasIn) throw new Error(`${path} must define exactly one of equals or in`);
  return {
    variable: requiredString(input.variable, `${path}.variable`),
    ...(hasEquals
      ? { equals: clonePortable(input.equals) }
      : { in: clonePortable(input.in) }),
  };
}

function normalizeCue(value, index, actorIds, operations) {
  const path = `sequence.cues[${index}]`;
  const input = clonePortable(value);
  if (!isPlainObject(input)) throw new TypeError(`${path} must be an object`);
  const action = clonePortable(input.action);
  if (!isPlainObject(action)) throw new TypeError(`${path}.action must be an object`);
  const operationId = requiredString(action.op, `${path}.action.op`);
  const operation = operations[operationId];
  if (!operation) throw new Error(`${path}.action.op references unknown operation: ${operationId}`);
  const target = optionalString(input.target, `${path}.target`);
  if (operation.target === "actor" && !target) throw new Error(`${path}.target is required for ${operationId}`);
  if (target && !actorIds.has(target)) throw new Error(`${path}.target references unknown actor: ${target}`);
  const timeout = finiteNumber(input.timeout, null, `${path}.timeout`);
  if (timeout !== null && timeout <= 0) throw new TypeError(`${path}.timeout must be greater than zero`);
  const onTimeout = requiredString(input.onTimeout ?? "fail", `${path}.onTimeout`);
  if (!TIMEOUT_POLICIES.includes(onTimeout)) throw new Error(`${path}.onTimeout has unsupported value: ${onTimeout}`);
  const complete = input.complete === undefined
    ? clonePortable(operation.completion)
    : normalizeCompletion(input.complete, `${path}.complete`);
  return {
    id: requiredString(input.id, `${path}.id`),
    target,
    start: normalizeStart(input.start, `${path}.start`),
    when: normalizeCondition(input.when, `${path}.when`),
    action,
    complete,
    timeout,
    onTimeout,
    metadata: clonePortable(input.metadata ?? {}),
  };
}

export function sequenceCueDependencies(cue) {
  if (["after", "with", "marker"].includes(cue.start.type)) return [cue.start.cue];
  if (["any", "all"].includes(cue.start.type)) return [...cue.start.cues];
  return [];
}

function semanticIssues(sequence, operations) {
  const errors = [];
  const cueById = new Map();
  sequence.cues.forEach((cue, index) => {
    if (cueById.has(cue.id)) {
      errors.push(issue("cue/duplicate-id", `$.cues[${index}].id`, `Duplicate sequence cue id: ${cue.id}`));
    } else cueById.set(cue.id, cue);
    if (!operations[cue.action.op]) {
      errors.push(issue("cue/unknown-operation", `$.cues[${index}].action.op`, `Unknown operation: ${cue.action.op}`));
    }
  });
  sequence.cues.forEach((cue, index) => {
    for (const dependency of sequenceCueDependencies(cue)) {
      if (!cueById.has(dependency)) {
        errors.push(issue("cue/missing-dependency", `$.cues[${index}].start`, `Cue ${cue.id} references missing cue ${dependency}`));
      }
    }
    if (cue.action.op === "sequence/set-variable") {
      if (typeof cue.action.name !== "string" || !cue.action.name.trim()) {
        errors.push(issue("cue/variable-name", `$.cues[${index}].action.name`, "sequence/set-variable requires a name"));
      }
    }
    if (cue.action.op === "sequence/choose") {
      if (typeof cue.action.variable !== "string" || !cue.action.variable.trim()) {
        errors.push(issue("cue/choice-variable", `$.cues[${index}].action.variable`, "sequence/choose requires a variable"));
      }
      if (!Array.isArray(cue.action.cases) || !cue.action.cases.length) {
        errors.push(issue("cue/choice-cases", `$.cues[${index}].action.cases`, "sequence/choose requires one or more cases"));
      }
    }
    if (cue.action.op === "character/move-to") {
      if (cue.action.mark !== undefined) {
        if (typeof cue.action.mark !== "string" || !sequence.marks[cue.action.mark]) {
          errors.push(issue("cue/missing-mark", `$.cues[${index}].action.mark`, `Cue ${cue.id} references an unknown scene mark`));
        }
      } else if (!Array.isArray(cue.action.position) || cue.action.position.length !== 3) {
        errors.push(issue("cue/move-target", `$.cues[${index}].action`, "character/move-to requires a scene mark or three-number position"));
      }
    }
    if (cue.action.op === "character/look-at" && typeof cue.action.target === "string"
      && !sequence.actors[cue.action.target] && !sequence.marks[cue.action.target]) {
      errors.push(issue("cue/look-target", `$.cues[${index}].action.target`, `Cue ${cue.id} references an unknown actor or mark`));
    }
  });

  const visiting = new Set();
  const visited = new Set();
  const visit = (cueId, stack = []) => {
    if (visiting.has(cueId)) {
      errors.push(issue("cue/dependency-cycle", "$.cues", `Sequence dependency cycle: ${[...stack, cueId].join(" -> ")}`));
      return;
    }
    if (visited.has(cueId) || !cueById.has(cueId)) return;
    visiting.add(cueId);
    const cue = cueById.get(cueId);
    for (const dependency of sequenceCueDependencies(cue)) visit(dependency, [...stack, cueId]);
    visiting.delete(cueId);
    visited.add(cueId);
  };
  for (const cue of sequence.cues) visit(cue.id);
  return errors;
}

export class SequenceValidationError extends Error {
  constructor(message, validation) {
    super(message);
    this.name = "SequenceValidationError";
    this.validation = validation;
  }
}

function normalizeSequenceUnchecked(value, operations) {
  const input = clonePortable(value);
  if (!isPlainObject(input)) throw new TypeError("Hodos sequence must be an object");
  const schema = requiredString(input.schema ?? SEQUENCE_SCHEMA, "sequence.schema");
  if (schema !== SEQUENCE_SCHEMA) throw new Error(`Hodos sequence has unsupported schema: ${schema}`);
  const actorInput = input.actors ?? {};
  const markInput = input.marks ?? {};
  if (!isPlainObject(actorInput)) throw new TypeError("sequence.actors must be an object");
  if (!isPlainObject(markInput)) throw new TypeError("sequence.marks must be an object");
  const actorKeys = Object.keys(actorInput).sort();
  const markKeys = Object.keys(markInput).sort();
  if (actorKeys.length > MAX_SEQUENCE_ACTORS) throw new Error(`sequence.actors exceed the bounded limit of ${MAX_SEQUENCE_ACTORS}`);
  if (markKeys.length > MAX_SEQUENCE_MARKS) throw new Error(`sequence.marks exceed the bounded limit of ${MAX_SEQUENCE_MARKS}`);
  const actors = {};
  for (const id of actorKeys) actors[id] = normalizeActor(actorInput[id], id, `sequence.actors.${id}`);
  const marks = {};
  for (const id of markKeys) marks[id] = normalizeMark(markInput[id], id, `sequence.marks.${id}`);
  const actorIds = new Set(Object.keys(actors));
  const timebaseInput = clonePortable(input.timebase ?? {});
  if (!isPlainObject(timebaseInput)) throw new TypeError("sequence.timebase must be an object");
  const unit = requiredString(timebaseInput.unit ?? "seconds", "sequence.timebase.unit");
  if (unit !== "seconds") throw new Error(`sequence.timebase.unit has unsupported value: ${unit}`);
  const fps = safeInteger(timebaseInput.fps, 30, "sequence.timebase.fps", 1);
  if (fps > 240) throw new TypeError("sequence.timebase.fps must be no greater than 240");
  if (!Array.isArray(input.cues ?? [])) throw new TypeError("sequence.cues must be an array");
  if ((input.cues ?? []).length > MAX_SEQUENCE_CUES) throw new Error(`sequence.cues exceed the bounded limit of ${MAX_SEQUENCE_CUES}`);
  const cues = (input.cues ?? []).map((cue, index) => normalizeCue(cue, index, actorIds, operations));
  return {
    schema,
    id: requiredString(input.id ?? input.sequenceId, "sequence.id"),
    version: safeInteger(input.version, 1, "sequence.version", 1),
    revision: safeInteger(input.revision, 0, "sequence.revision"),
    name: optionalString(input.name, "sequence.name"),
    timebase: { unit, fps },
    actors,
    marks,
    variables: clonePortable(input.variables ?? {}),
    cues,
    metadata: clonePortable(input.metadata ?? {}),
  };
}

export function validateSequence(value, { operations = DEFAULT_SEQUENCE_OPERATIONS } = {}) {
  try {
    const registry = normalizeSequenceOperationRegistry(operations);
    const sequence = normalizeSequenceUnchecked(value, registry);
    return validationResult(semanticIssues(sequence, registry));
  } catch (error) {
    return validationResult([
      issue("sequence/invalid", "$", error instanceof Error ? error.message : String(error)),
    ]);
  }
}

export function normalizeSequence(value, { operations = DEFAULT_SEQUENCE_OPERATIONS } = {}) {
  const registry = normalizeSequenceOperationRegistry(operations);
  const sequence = normalizeSequenceUnchecked(value, registry);
  const validation = validationResult(semanticIssues(sequence, registry));
  if (!validation.valid) throw new SequenceValidationError("Hodos sequence is invalid", validation);
  return sequence;
}

export function createSequence(options, configuration) {
  return normalizeSequence(options, configuration);
}
