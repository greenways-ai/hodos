import {
  DEFAULT_SEQUENCE_OPERATIONS,
  SEQUENCE_CUE_STATUSES,
  SEQUENCE_EVENT_TYPES,
  SEQUENCE_STATE_SCHEMA,
  SEQUENCE_STATUSES,
  SEQUENCE_TRACE_SCHEMA,
  normalizeSequence,
  normalizeSequenceOperationRegistry,
} from "./sequence-model.js";
import {
  clonePortable,
  finiteNumber,
  isPlainObject,
  optionalString,
  portableEqual,
  requiredString,
  safeInteger,
} from "./model-values.js";

const TERMINAL_CUE_STATUSES = new Set(["completed", "failed", "cancelled", "skipped"]);
const TERMINAL_SEQUENCE_STATUSES = new Set(["completed", "failed", "cancelled"]);
const DEFAULT_MAX_TRACE = 256;
const DEFAULT_MAX_EVENTS = 1024;

function normalizeBindings(sequence, value) {
  const input = clonePortable(value ?? {});
  if (!isPlainObject(input)) throw new TypeError("Sequence bindings must be an object");
  const output = {};
  for (const actorId of Object.keys(sequence.actors)) {
    const base = sequence.actors[actorId];
    const override = clonePortable(input[actorId] ?? {});
    if (!isPlainObject(override)) throw new TypeError(`Sequence binding ${actorId} must be an object`);
    const metadata = clonePortable(override.metadata ?? {});
    if (!isPlainObject(metadata)) throw new TypeError(`Sequence binding ${actorId} metadata must be an object`);
    output[actorId] = {
      id: actorId,
      entityId: optionalString(override.entityId ?? override["entity/id"] ?? base.entityId, `Sequence binding ${actorId} entityId`),
      characterId: optionalString(override.characterId ?? override["character/id"] ?? base.characterId, `Sequence binding ${actorId} characterId`),
      metadata: clonePortable({ ...base.metadata, ...metadata }),
    };
  }
  for (const actorId of Object.keys(input)) {
    if (!sequence.actors[actorId]) throw new Error(`Sequence binding references unknown actor: ${actorId}`);
  }
  return output;
}

function transition(state, effects = [], events = [], trace = []) {
  return { state, effects, events, trace };
}

function appendTrace(state, type, data = {}) {
  state.traceSequence += 1;
  const record = {
    schema: SEQUENCE_TRACE_SCHEMA,
    sequence: state.traceSequence,
    type,
    at: state.time,
    data: clonePortable(data),
  };
  state.trace.push(record);
  if (state.trace.length > state.options.maxTrace) {
    state.trace.splice(0, state.trace.length - state.options.maxTrace);
    state.traceTruncated = true;
  }
  return record;
}

function cueState(state, cueId) {
  return state.cues[cueId];
}

function markerPresent(state, cueId, marker) {
  return cueState(state, cueId)?.markers.some((entry) => entry.name === marker) ?? false;
}

function dependencyReadiness(state, cue) {
  const start = cue.start;
  if (start.type === "at") return state.time >= start.at ? "ready" : "waiting";
  if (start.type === "after") {
    const dependency = cueState(state, start.cue);
    if (dependency.status === "completed") return "ready";
    return TERMINAL_CUE_STATUSES.has(dependency.status) ? "impossible" : "waiting";
  }
  if (start.type === "with") {
    const dependency = cueState(state, start.cue);
    if (dependency.startedAt !== null) return "ready";
    return TERMINAL_CUE_STATUSES.has(dependency.status) ? "impossible" : "waiting";
  }
  if (start.type === "marker") {
    if (markerPresent(state, start.cue, start.marker)) return "ready";
    const dependency = cueState(state, start.cue);
    return TERMINAL_CUE_STATUSES.has(dependency.status) ? "impossible" : "waiting";
  }
  const dependencies = start.cues.map((id) => cueState(state, id));
  if (start.type === "any") {
    if (dependencies.some(({ status }) => status === "completed")) return "ready";
    return dependencies.every(({ status }) => TERMINAL_CUE_STATUSES.has(status)) ? "impossible" : "waiting";
  }
  if (dependencies.every(({ status }) => status === "completed")) return "ready";
  return dependencies.some(({ status }) => TERMINAL_CUE_STATUSES.has(status) && status !== "completed")
    ? "impossible"
    : "waiting";
}

function conditionReadiness(state, cue) {
  if (!cue.when) return "ready";
  if (!Object.hasOwn(state.variables, cue.when.variable)) return "waiting";
  const value = state.variables[cue.when.variable];
  if (Object.hasOwn(cue.when, "equals")) {
    return portableEqual(value, cue.when.equals) ? "ready" : "false";
  }
  if (!Array.isArray(cue.when.in)) return "false";
  return cue.when.in.some((candidate) => portableEqual(candidate, value))
    ? "ready"
    : "false";
}

function effectForCue(state, cue, operation) {
  return {
    type: "sequence/action",
    id: `${state.sequence.id}/${cue.id}`,
    sequenceId: state.sequence.id,
    cueId: cue.id,
    operation: cue.action.op,
    target: cue.target ? clonePortable(state.bindings[cue.target]) : null,
    action: clonePortable(cue.action),
    at: state.time,
    preview: state.options.preview,
    capabilities: [...operation.capabilities],
  };
}

function completeCue(state, cue, result, outputEvents, outputTrace) {
  const current = cueState(state, cue.id);
  if (current.status !== "active") return false;
  current.status = "completed";
  current.completedAt = state.time;
  current.result = result === undefined ? null : clonePortable(result);
  const record = appendTrace(state, "sequence/cue-completed", {
    cueId: cue.id,
    result: current.result,
  });
  outputTrace.push(record);
  outputEvents.push({
    type: "sequence/cue-completed",
    sequenceId: state.sequence.id,
    cueId: cue.id,
    at: state.time,
    result: current.result,
  });
  return true;
}

function skipCue(state, cue, reason, outputEvents, outputTrace) {
  const current = cueState(state, cue.id);
  if (current.status !== "pending") return false;
  current.status = "skipped";
  current.completedAt = state.time;
  current.reason = reason;
  const record = appendTrace(state, "sequence/cue-skipped", { cueId: cue.id, reason });
  outputTrace.push(record);
  outputEvents.push({
    type: "sequence/cue-skipped",
    sequenceId: state.sequence.id,
    cueId: cue.id,
    reason,
    at: state.time,
  });
  return true;
}

function failSequence(state, cueId, error, outputEvents, outputTrace) {
  const message = error instanceof Error ? error.message : String(error);
  if (cueId && cueState(state, cueId)?.status === "active") {
    const current = cueState(state, cueId);
    current.status = "failed";
    current.completedAt = state.time;
    current.error = message;
  }
  for (const current of Object.values(state.cues)) {
    if (current.status === "pending" || current.status === "active") {
      current.status = "cancelled";
      current.completedAt = state.time;
      current.reason = "sequence-failed";
    }
  }
  state.status = "failed";
  state.error = message;
  const record = appendTrace(state, "sequence/failed", { cueId, error: message });
  outputTrace.push(record);
  outputEvents.push({
    type: "sequence/failed",
    sequenceId: state.sequence.id,
    cueId,
    error: message,
    at: state.time,
  });
}

function cancelSequence(state, reason, outputEvents, outputTrace) {
  for (const current of Object.values(state.cues)) {
    if (current.status === "pending" || current.status === "active") {
      current.status = "cancelled";
      current.completedAt = state.time;
      current.reason = reason;
    }
  }
  state.status = "cancelled";
  const record = appendTrace(state, "sequence/cancelled", { reason });
  outputTrace.push(record);
  outputEvents.push({
    type: "sequence/cancelled",
    sequenceId: state.sequence.id,
    reason,
    at: state.time,
  });
}

function startCue(state, cue, effects, outputEvents, outputTrace) {
  const current = cueState(state, cue.id);
  const operation = state.operations[cue.action.op];
  if (state.options.preview && (!operation.previewSafe || !operation.reversible)) {
    throw new Error(`Sequence cue ${cue.id} cannot be replayed safely during seek`);
  }
  current.status = "active";
  current.startedAt = state.time;
  const started = appendTrace(state, "sequence/cue-started", {
    cueId: cue.id,
    operation: cue.action.op,
    target: cue.target,
  });
  outputTrace.push(started);
  outputEvents.push({
    type: "sequence/cue-started",
    sequenceId: state.sequence.id,
    cueId: cue.id,
    operation: cue.action.op,
    target: cue.target,
    at: state.time,
  });

  if (cue.action.op === "sequence/set-variable") {
    state.variables[requiredString(cue.action.name, `cue ${cue.id} variable name`)] = clonePortable(cue.action.value);
  }
  if (operation.hostEffect) effects.push(effectForCue(state, cue, operation));
  if (cue.complete.mode === "immediate") completeCue(state, cue, null, outputEvents, outputTrace);
}

function updateOverallStatus(state, outputEvents, outputTrace) {
  if (TERMINAL_SEQUENCE_STATUSES.has(state.status)) return;
  const values = Object.values(state.cues);
  if (values.some(({ status }) => status === "failed")) {
    failSequence(state, null, "A sequence cue failed", outputEvents, outputTrace);
    return;
  }
  if (values.every(({ status }) => status === "completed" || status === "skipped")) {
    state.status = "completed";
    const record = appendTrace(state, "sequence/completed", {
      completed: values.filter(({ status }) => status === "completed").length,
      skipped: values.filter(({ status }) => status === "skipped").length,
    });
    outputTrace.push(record);
    outputEvents.push({
      type: "sequence/completed",
      sequenceId: state.sequence.id,
      at: state.time,
      variables: clonePortable(state.variables),
    });
  }
}

function advance(state, effects, outputEvents, outputTrace) {
  let changed = true;
  let passes = 0;
  const maximum = state.sequence.cues.length * 4 + 4;
  while (changed && !TERMINAL_SEQUENCE_STATUSES.has(state.status)) {
    changed = false;
    passes += 1;
    if (passes > maximum) throw new Error("Sequence advancement did not reach a stable state");
    for (const cue of state.sequence.cues) {
      if (cueState(state, cue.id).status !== "pending") continue;
      const dependency = dependencyReadiness(state, cue);
      const condition = conditionReadiness(state, cue);
      if (dependency === "impossible") {
        changed = skipCue(state, cue, "dependency-unavailable", outputEvents, outputTrace) || changed;
      } else if (dependency === "ready" && condition === "false") {
        changed = skipCue(state, cue, "condition-false", outputEvents, outputTrace) || changed;
      } else if (dependency === "ready" && condition === "ready") {
        startCue(state, cue, effects, outputEvents, outputTrace);
        changed = true;
      }
    }
  }
  updateOverallStatus(state, outputEvents, outputTrace);
}

function processTimeouts(state, outputEvents, outputTrace) {
  for (const cue of state.sequence.cues) {
    const current = cueState(state, cue.id);
    if (current.status !== "active" || cue.timeout === null) continue;
    if (state.time - current.startedAt < cue.timeout) continue;
    if (cue.onTimeout === "complete") {
      completeCue(state, cue, { timeout: true }, outputEvents, outputTrace);
    } else if (cue.onTimeout === "skip") {
      current.status = "skipped";
      current.completedAt = state.time;
      current.reason = "timeout";
      const record = appendTrace(state, "sequence/cue-skipped", { cueId: cue.id, reason: "timeout" });
      outputTrace.push(record);
      outputEvents.push({ type: "sequence/cue-skipped", sequenceId: state.sequence.id, cueId: cue.id, reason: "timeout", at: state.time });
    } else if (cue.onTimeout === "cancel") {
      cancelSequence(state, `Cue ${cue.id} timed out`, outputEvents, outputTrace);
      return;
    } else {
      failSequence(state, cue.id, `Sequence cue ${cue.id} timed out`, outputEvents, outputTrace);
      return;
    }
  }
}

function validateState(value) {
  const state = clonePortable(value);
  if (!isPlainObject(state) || state.schema !== SEQUENCE_STATE_SCHEMA) {
    throw new TypeError("Sequence runtime requires a hodos.sequence-state/0-alpha value");
  }
  if (!SEQUENCE_STATUSES.includes(state.status)) throw new Error(`Unsupported sequence status: ${state.status}`);
  for (const [cueId, current] of Object.entries(state.cues ?? {})) {
    if (!SEQUENCE_CUE_STATUSES.includes(current.status)) throw new Error(`Unsupported status for cue ${cueId}: ${current.status}`);
  }
  return state;
}

function boundedOption(value, fallback, maximum, label) {
  const number = safeInteger(value, fallback, label, 1);
  if (number > maximum) throw new TypeError(`${label} must be no greater than ${maximum}`);
  return number;
}

export function openSequence(sequenceValue, bindings = {}, {
  operations = DEFAULT_SEQUENCE_OPERATIONS,
  maxTrace = DEFAULT_MAX_TRACE,
  maxEvents = DEFAULT_MAX_EVENTS,
  preview = false,
} = {}) {
  const normalizedOperations = normalizeSequenceOperationRegistry(operations);
  const sequence = normalizeSequence(sequenceValue, { operations: normalizedOperations });
  const state = {
    schema: SEQUENCE_STATE_SCHEMA,
    sequence,
    operations: normalizedOperations,
    bindings: normalizeBindings(sequence, bindings),
    status: "running",
    time: 0,
    variables: clonePortable(sequence.variables),
    cues: Object.fromEntries(sequence.cues.map((cue) => [cue.id, {
      status: "pending",
      startedAt: null,
      completedAt: null,
      markers: [],
      result: null,
      error: null,
      reason: null,
    }])),
    seenEventIds: [],
    trace: [],
    traceSequence: 0,
    traceTruncated: false,
    error: null,
    options: {
      maxTrace: boundedOption(maxTrace, DEFAULT_MAX_TRACE, 4_096, "Sequence maxTrace"),
      maxEvents: boundedOption(maxEvents, DEFAULT_MAX_EVENTS, 16_384, "Sequence maxEvents"),
      preview: preview === true,
    },
  };
  const effects = [];
  const events = [];
  const records = [appendTrace(state, "sequence/opened", {
    sequenceId: sequence.id,
    version: sequence.version,
  })];
  advance(state, effects, events, records);
  return transition(state, effects, events, records);
}

export function tickSequence(stateValue, logicalTime) {
  const state = validateState(stateValue);
  if (TERMINAL_SEQUENCE_STATUSES.has(state.status)) return transition(state);
  const time = finiteNumber(logicalTime, state.time, "Sequence logical time");
  if (time < state.time) throw new Error("Sequence logical time cannot move backwards; use seekSequence for preview reconstruction");
  state.time = time;
  const effects = [];
  const events = [];
  const records = [];
  processTimeouts(state, events, records);
  if (!TERMINAL_SEQUENCE_STATUSES.has(state.status)) advance(state, effects, events, records);
  return transition(state, effects, events, records);
}

function diagnostic(state, event, reason) {
  return transition(state, [], [{
    type: "sequence/event-ignored",
    sequenceId: state.sequence.id,
    eventId: event.id ?? null,
    reason,
    at: state.time,
  }]);
}

export function applySequenceEvent(stateValue, eventValue) {
  const state = validateState(stateValue);
  const event = clonePortable(eventValue);
  if (!isPlainObject(event)) throw new TypeError("Sequence event must be an object");
  const id = requiredString(event.id, "Sequence event id");
  const type = requiredString(event.type, "Sequence event type");
  if (!SEQUENCE_EVENT_TYPES.includes(type)) return diagnostic(state, event, `unsupported event type ${type}`);
  if (state.seenEventIds.includes(id)) return transition(state);
  if (TERMINAL_SEQUENCE_STATUSES.has(state.status)) return diagnostic(state, event, `sequence is ${state.status}`);
  if (state.seenEventIds.length >= state.options.maxEvents) {
    const events = [];
    const records = [];
    failSequence(state, null, "Sequence event identity capacity was exceeded", events, records);
    return transition(state, [], events, records);
  }
  state.seenEventIds.push(id);
  if (event.at !== undefined) state.time = Math.max(state.time, finiteNumber(event.at, state.time, "Sequence event time"));
  const effects = [];
  const events = [];
  const records = [];

  if (type === "sequence/cancel") {
    cancelSequence(state, String(event.reason ?? "cancelled"), events, records);
    return transition(state, effects, events, records);
  }
  if (type === "sequence/variable-set") {
    const name = requiredString(event.name, "Sequence variable name");
    state.variables[name] = clonePortable(event.value);
    records.push(appendTrace(state, "sequence/variable-set", { name, value: state.variables[name], eventId: id }));
    events.push({ type: "sequence/variable-set", sequenceId: state.sequence.id, name, value: clonePortable(event.value), at: state.time });
    advance(state, effects, events, records);
    return transition(state, effects, events, records);
  }

  const cueId = requiredString(event.cueId, "Sequence event cueId");
  const cue = state.sequence.cues.find(({ id: candidate }) => candidate === cueId);
  const current = cueState(state, cueId);
  if (!cue || !current || current.status !== "active") return diagnostic(state, event, `cue ${cueId} is not active`);

  if (type === "sequence/marker") {
    const marker = requiredString(event.marker, "Sequence marker name");
    if (!current.markers.some(({ name }) => name === marker)) {
      current.markers.push({ name: marker, at: state.time, value: event.value === undefined ? null : clonePortable(event.value) });
      records.push(appendTrace(state, "sequence/marker", { cueId, marker, eventId: id, value: event.value ?? null }));
      events.push({ type: "sequence/marker", sequenceId: state.sequence.id, cueId, marker, at: state.time, value: event.value ?? null });
    }
    if (cue.complete.mode === "marker" && cue.complete.marker === marker) {
      completeCue(state, cue, event.value, events, records);
    }
  } else if (type === "sequence/cue-complete") {
    completeCue(state, cue, event.result, events, records);
  } else if (type === "sequence/cue-failed") {
    failSequence(state, cueId, event.error ?? `Sequence cue ${cueId} failed`, events, records);
  } else if (type === "sequence/choice") {
    if (cue.action.op !== "sequence/choose") return diagnostic(state, event, `cue ${cueId} is not a choice`);
    const value = clonePortable(event.value);
    const cases = cue.action.cases;
    if (!cases.some((candidate) => portableEqual(candidate, value))) {
      return diagnostic(state, event, `choice value is not declared by cue ${cueId}`);
    }
    const variable = requiredString(cue.action.variable, `Sequence choice ${cueId} variable`);
    state.variables[variable] = value;
    records.push(appendTrace(state, "sequence/choice", { cueId, variable, value, eventId: id }));
    completeCue(state, cue, { variable, value }, events, records);
  }

  if (!TERMINAL_SEQUENCE_STATUSES.has(state.status)) advance(state, effects, events, records);
  return transition(state, effects, events, records);
}

export function seekSequence(sequenceValue, logicalTime, bindings = {}, options = {}) {
  const opened = openSequence(sequenceValue, bindings, { ...options, preview: true });
  return tickSequence(opened.state, logicalTime);
}
