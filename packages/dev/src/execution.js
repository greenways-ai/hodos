import { WORKSPACE_COMPONENT_CONTRACT } from "@greenways/hodos-web";

export const HARA_BYTECODE_METRICS_SCHEMA = "hal.bytecode-metrics/v1";
export const HARA_BYTECODE_EVENTS_SCHEMA = "hal.bytecode-events/v1";
export const HARA_BYTECODE_TRACE_SCHEMA = "hal.bytecode-trace/v1";

export const HODOS_DEV_EXECUTION_AREA_TYPE = "hodos.dev/execution";
export const HODOS_DEV_EXECUTION_COMPONENT_ID = "hodos.dev/execution";
export const HODOS_DEV_EXECUTION_EVENTS = Object.freeze([
  "execution/connect",
  "execution/ingest",
  "execution/select",
  "execution/pause",
  "execution/resume",
  "execution/reset",
  "execution/request-trace",
]);

const EXECUTION_STATUSES = new Set([
  "idle",
  "connected",
  "running",
  "paused",
  "suspended",
  "returned",
  "failed",
]);
const TRANSITION_KINDS = new Set([
  "call/enter",
  "call/return",
  "exception/unwind",
  "machine/suspend",
  "machine/resume",
]);
const TERMINAL_KINDS = new Set(["machine/return", "machine/fail"]);

const objectValue = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
};

const nonEmptyString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
};

const optionalString = (value, label) => value == null ? null : nonEmptyString(value, label);

const nonNegativeInteger = (value, label, fallback = null) => {
  if (value == null && fallback != null) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return number;
};

const optionalInteger = (value, label) => value == null
  ? null
  : nonNegativeInteger(value, label);

const booleanValue = (value, label, fallback = false) => {
  const resolved = value ?? fallback;
  if (typeof resolved !== "boolean") throw new TypeError(`${label} must be boolean`);
  return resolved;
};

const serializableValue = (value, label, ancestors = new Set()) => {
  if (value == null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${label} numbers must be finite`);
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${label} must contain only serializable values`);
  }
  if (ancestors.has(value)) throw new TypeError(`${label} must not contain cycles`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((entry, index) =>
        serializableValue(entry, `${label}[${index}]`, ancestors)));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${label} objects must be plain`);
    }
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = serializableValue(entry, `${label}.${key}`, ancestors);
    }
    return Object.freeze(output);
  } finally {
    ancestors.delete(value);
  }
};

const positionValue = (value, label) => {
  if (value == null) return null;
  const position = objectValue(value, label);
  return Object.freeze({
    offset: optionalInteger(position.offset, `${label} offset`),
    line: optionalInteger(position.line, `${label} line`),
    column: optionalInteger(position.column, `${label} column`),
  });
};

const selectionValue = (value = {}) => {
  const selection = objectValue(value, "Hodos Dev Execution selection");
  return Object.freeze({
    function: optionalInteger(selection.function, "Hodos Dev Execution selected function"),
    ip: optionalInteger(selection.ip, "Hodos Dev Execution selected instruction"),
    source: positionValue(selection.source, "Hodos Dev Execution selected source"),
    eventIndex: optionalInteger(selection.eventIndex, "Hodos Dev Execution selected event index"),
    traceIndex: optionalInteger(selection.traceIndex, "Hodos Dev Execution selected trace index"),
  });
};

const capabilitiesValue = (value = {}) => {
  const capabilities = objectValue(value, "Hodos Dev Execution capabilities");
  return Object.freeze({
    pause: booleanValue(capabilities.pause, "Hodos Dev Execution pause capability"),
    resume: booleanValue(capabilities.resume, "Hodos Dev Execution resume capability"),
    reset: booleanValue(capabilities.reset, "Hodos Dev Execution reset capability", true),
    requestTrace: booleanValue(
      capabilities.requestTrace,
      "Hodos Dev Execution requestTrace capability",
    ),
  });
};

const limitsValue = (value = {}) => {
  const limits = objectValue(value, "Hodos Dev Execution limits");
  const events = nonNegativeInteger(limits.events ?? 512, "Hodos Dev Execution event limit");
  const trace = nonNegativeInteger(limits.trace ?? 128, "Hodos Dev Execution trace limit");
  const diagnostics = nonNegativeInteger(
    limits.diagnostics ?? 64,
    "Hodos Dev Execution diagnostic limit",
  );
  return Object.freeze({ events, trace, diagnostics });
};

const diagnosticValue = (value, index) => {
  const diagnostic = objectValue(value, `Hodos Dev Execution diagnostic ${index}`);
  return Object.freeze({
    code: optionalString(diagnostic.code, `Hodos Dev Execution diagnostic ${index} code`),
    message: nonEmptyString(
      diagnostic.message,
      `Hodos Dev Execution diagnostic ${index} message`,
    ),
    severity: nonEmptyString(
      diagnostic.severity ?? "error",
      `Hodos Dev Execution diagnostic ${index} severity`,
    ),
    evidence: serializableValue(
      diagnostic.evidence ?? null,
      `Hodos Dev Execution diagnostic ${index} evidence`,
    ),
  });
};

const opcodeCountsValue = (value = {}) => {
  const output = {};
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      const count = objectValue(entry, `Hara bytecode opcode count ${index}`);
      const opcode = nonEmptyString(
        count.opcode,
        `Hara bytecode opcode count ${index} opcode`,
      );
      output[opcode] = nonNegativeInteger(
        count.count,
        `Hara bytecode opcode count ${index} count`,
      );
    });
    return Object.freeze(output);
  }
  const counts = objectValue(value, "Hara bytecode metrics opcodeCounts");
  for (const [opcode, count] of Object.entries(counts)) {
    output[nonEmptyString(opcode, "Hara bytecode metrics opcode")] = nonNegativeInteger(
      count,
      `Hara bytecode metrics opcode ${opcode}`,
    );
  }
  return Object.freeze(output);
};

export function normalizeBytecodeMetrics(payload) {
  const value = objectValue(payload, "Hara bytecode metrics");
  const schema = nonEmptyString(value.schema, "Hara bytecode metrics schema");
  if (schema !== HARA_BYTECODE_METRICS_SCHEMA) {
    throw new Error(`Unsupported Hara bytecode metrics schema: ${schema}`);
  }
  return Object.freeze({
    schema,
    instructions: nonNegativeInteger(value.instructions ?? 0, "Hara bytecode instructions"),
    opcodeCounts: opcodeCountsValue(value.opcodeCounts ?? value.opcode_counts ?? {}),
    calls: nonNegativeInteger(value.calls ?? 0, "Hara bytecode calls"),
    returns: nonNegativeInteger(value.returns ?? 0, "Hara bytecode returns"),
    unwinds: nonNegativeInteger(value.unwinds ?? 0, "Hara bytecode unwinds"),
    suspensions: nonNegativeInteger(value.suspensions ?? 0, "Hara bytecode suspensions"),
    resumptions: nonNegativeInteger(value.resumptions ?? 0, "Hara bytecode resumptions"),
    terminalReturns: nonNegativeInteger(
      value.terminalReturns ?? value.terminal_returns ?? 0,
      "Hara bytecode terminal returns",
    ),
    failures: nonNegativeInteger(value.failures ?? 0, "Hara bytecode failures"),
    maxStackDepth: nonNegativeInteger(
      value.maxStackDepth ?? value.max_stack_depth ?? 0,
      "Hara bytecode maximum stack depth",
    ),
    maxCallDepth: nonNegativeInteger(
      value.maxCallDepth ?? value.max_call_depth ?? 0,
      "Hara bytecode maximum call depth",
    ),
  });
}

const instructionEventValue = (event, label) => Object.freeze({
  kind: "instruction",
  function: nonNegativeInteger(event.function, `${label} function`),
  ip: nonNegativeInteger(event.ip, `${label} instruction`),
  opcode: nonEmptyString(event.opcode, `${label} opcode`),
  stackDepth: nonNegativeInteger(
    event.stackDepth ?? event.stack_depth ?? 0,
    `${label} stack depth`,
  ),
  callDepth: nonNegativeInteger(
    event.callDepth ?? event.call_depth ?? 0,
    `${label} call depth`,
  ),
});

const transitionEventValue = (event, label) => {
  const transition = nonEmptyString(event.transition, `${label} transition`);
  if (!TRANSITION_KINDS.has(transition)) {
    throw new Error(`${label} has unsupported transition: ${transition}`);
  }
  return Object.freeze({
    kind: "transition",
    transition,
    fromFunction: nonNegativeInteger(
      event.fromFunction ?? event.from_function,
      `${label} from function`,
    ),
    fromIp: nonNegativeInteger(event.fromIp ?? event.from_ip, `${label} from instruction`),
    toFunction: nonNegativeInteger(
      event.toFunction ?? event.to_function,
      `${label} to function`,
    ),
    toIp: nonNegativeInteger(event.toIp ?? event.to_ip, `${label} to instruction`),
    stackDepth: nonNegativeInteger(
      event.stackDepth ?? event.stack_depth ?? 0,
      `${label} stack depth`,
    ),
    callDepth: nonNegativeInteger(
      event.callDepth ?? event.call_depth ?? 0,
      `${label} call depth`,
    ),
  });
};

const terminalEventValue = (event, label) => {
  const terminal = nonEmptyString(event.terminal, `${label} terminal`);
  if (!TERMINAL_KINDS.has(terminal)) {
    throw new Error(`${label} has unsupported terminal: ${terminal}`);
  }
  return Object.freeze({
    kind: "terminal",
    terminal,
    function: nonNegativeInteger(event.function, `${label} function`),
    ip: nonNegativeInteger(event.ip, `${label} instruction`),
    stackDepth: nonNegativeInteger(
      event.stackDepth ?? event.stack_depth ?? 0,
      `${label} stack depth`,
    ),
    callDepth: nonNegativeInteger(
      event.callDepth ?? event.call_depth ?? 0,
      `${label} call depth`,
    ),
  });
};

const compactEventValue = (event, index) => {
  const value = objectValue(event, `Hara bytecode event ${index}`);
  const kind = nonEmptyString(value.kind, `Hara bytecode event ${index} kind`);
  const label = `Hara bytecode event ${index}`;
  if (kind === "instruction") return instructionEventValue(value, label);
  if (kind === "transition") return transitionEventValue(value, label);
  if (kind === "terminal") return terminalEventValue(value, label);
  throw new Error(`${label} has unsupported kind: ${kind}`);
};

export function normalizeBytecodeEvents(payload) {
  const value = objectValue(payload, "Hara bytecode events");
  const schema = nonEmptyString(value.schema, "Hara bytecode events schema");
  if (schema !== HARA_BYTECODE_EVENTS_SCHEMA) {
    throw new Error(`Unsupported Hara bytecode events schema: ${schema}`);
  }
  if (!Array.isArray(value.events)) throw new TypeError("Hara bytecode events must be an array");
  return Object.freeze({
    schema,
    events: Object.freeze(value.events.map(compactEventValue)),
    dropped: nonNegativeInteger(value.dropped ?? 0, "Hara bytecode dropped events"),
  });
}

const traceStepValue = (step, index) => {
  const value = objectValue(step, `Hara bytecode trace step ${index}`);
  const before = serializableValue(value.before ?? {}, `Hara bytecode trace step ${index} before`);
  const after = serializableValue(value.after ?? {}, `Hara bytecode trace step ${index} after`);
  return Object.freeze({
    kind: nonEmptyString(value.kind, `Hara bytecode trace step ${index} kind`),
    status: optionalString(value.status, `Hara bytecode trace step ${index} status`),
    before,
    after,
    instruction: serializableValue(
      value.instruction ?? null,
      `Hara bytecode trace step ${index} instruction`,
    ),
    source: positionValue(value.source, `Hara bytecode trace step ${index} source`),
    error: optionalString(value.error, `Hara bytecode trace step ${index} error`),
  });
};

export function normalizeBytecodeTrace(payload) {
  const value = objectValue(payload, "Hara bytecode trace");
  const schema = nonEmptyString(value.schema, "Hara bytecode trace schema");
  if (schema !== HARA_BYTECODE_TRACE_SCHEMA) {
    throw new Error(`Unsupported Hara bytecode trace schema: ${schema}`);
  }
  const steps = value.steps ?? [value];
  if (!Array.isArray(steps)) throw new TypeError("Hara bytecode trace steps must be an array");
  return Object.freeze({ schema, steps: Object.freeze(steps.map(traceStepValue)) });
}

export function normalizeExecutionEvidence(payload) {
  const value = objectValue(payload, "Hodos Dev Execution evidence");
  const schema = nonEmptyString(value.schema, "Hodos Dev Execution evidence schema");
  if (schema === HARA_BYTECODE_METRICS_SCHEMA) {
    return Object.freeze({ level: "metrics", value: normalizeBytecodeMetrics(value) });
  }
  if (schema === HARA_BYTECODE_EVENTS_SCHEMA) {
    return Object.freeze({ level: "events", value: normalizeBytecodeEvents(value) });
  }
  if (schema === HARA_BYTECODE_TRACE_SCHEMA) {
    return Object.freeze({ level: "trace", value: normalizeBytecodeTrace(value) });
  }
  throw new Error(`Unsupported Hodos Dev Execution evidence schema: ${schema}`);
}

const boundedTail = (current, added, limit) => {
  const combined = [...current, ...added];
  const omitted = Math.max(0, combined.length - limit);
  return Object.freeze({
    values: Object.freeze(combined.slice(omitted)),
    omitted,
  });
};

const inferStatus = (status, evidence) => {
  if (evidence.level === "events") {
    const last = evidence.value.events.at(-1);
    if (last?.kind === "terminal") return last.terminal === "machine/fail" ? "failed" : "returned";
    if (last?.kind === "transition" && last.transition === "machine/suspend") return "suspended";
    if (last?.kind === "transition" && last.transition === "machine/resume") return "running";
    if (evidence.value.events.length > 0) return "running";
  }
  if (evidence.level === "trace") {
    const last = evidence.value.steps.at(-1);
    const projected = last?.after?.status;
    if (typeof projected === "string" && EXECUTION_STATUSES.has(projected)) return projected;
    if (last?.kind === "machine/fail") return "failed";
    if (last?.kind === "machine/return") return "returned";
    if (evidence.value.steps.length > 0) return "running";
  }
  return status;
};

const freezeState = ({
  session,
  evidence,
  retention,
  availability,
  capabilities,
  selection,
  diagnostics,
  metadata,
}) => Object.freeze({
  session: Object.freeze(session),
  evidence: Object.freeze(evidence),
  retention: Object.freeze(retention),
  availability: Object.freeze(availability),
  capabilities,
  selection,
  diagnostics: Object.freeze(diagnostics),
  metadata,
});

export function createExecutionState({
  sessionId = null,
  status = sessionId ? "connected" : "idle",
  metrics = null,
  compactEvents = [],
  traceSteps = [],
  eventsOmitted = 0,
  traceOmitted = 0,
  droppedEvents = 0,
  selection = {},
  capabilities = {},
  limits = {},
  diagnostics = [],
  metadata = {},
} = {}) {
  status = nonEmptyString(status, "Hodos Dev Execution status");
  if (!EXECUTION_STATUSES.has(status)) {
    throw new Error(`Unsupported Hodos Dev Execution status: ${status}`);
  }
  if (!Array.isArray(compactEvents)) {
    throw new TypeError("Hodos Dev Execution compactEvents must be an array");
  }
  if (!Array.isArray(traceSteps)) {
    throw new TypeError("Hodos Dev Execution traceSteps must be an array");
  }
  if (!Array.isArray(diagnostics)) {
    throw new TypeError("Hodos Dev Execution diagnostics must be an array");
  }
  const normalizedLimits = limitsValue(limits);
  const retainedEvents = boundedTail([], compactEvents.map(compactEventValue), normalizedLimits.events);
  const retainedTrace = boundedTail([], traceSteps.map(traceStepValue), normalizedLimits.trace);
  const retainedDiagnostics = diagnostics.map(diagnosticValue).slice(-normalizedLimits.diagnostics);
  const normalizedMetrics = metrics == null ? null : normalizeBytecodeMetrics(metrics);
  return freezeState({
    session: {
      id: optionalString(sessionId, "Hodos Dev Execution session id"),
      status,
    },
    evidence: {
      metrics: normalizedMetrics,
      events: retainedEvents.values,
      trace: retainedTrace.values,
    },
    retention: {
      limits: normalizedLimits,
      eventsOmitted: nonNegativeInteger(eventsOmitted, "Hodos Dev Execution events omitted")
        + retainedEvents.omitted,
      traceOmitted: nonNegativeInteger(traceOmitted, "Hodos Dev Execution trace omitted")
        + retainedTrace.omitted,
      droppedEvents: nonNegativeInteger(droppedEvents, "Hodos Dev Execution dropped events"),
    },
    availability: {
      metrics: normalizedMetrics != null,
      events: retainedEvents.values.length > 0,
      trace: retainedTrace.values.length > 0,
    },
    capabilities: capabilitiesValue(capabilities),
    selection: selectionValue(selection),
    diagnostics: retainedDiagnostics,
    metadata: serializableValue(metadata, "Hodos Dev Execution metadata"),
  });
}

export function ingestExecutionEvidence(state, payload) {
  const current = objectValue(state, "Hodos Dev Execution state");
  const normalized = normalizeExecutionEvidence(payload);
  const limits = current.retention.limits;
  let metrics = current.evidence.metrics;
  let events = current.evidence.events;
  let trace = current.evidence.trace;
  let eventsOmitted = current.retention.eventsOmitted;
  let traceOmitted = current.retention.traceOmitted;
  let droppedEvents = current.retention.droppedEvents;

  if (normalized.level === "metrics") metrics = normalized.value;
  if (normalized.level === "events") {
    const retained = boundedTail(events, normalized.value.events, limits.events);
    events = retained.values;
    eventsOmitted += retained.omitted;
    droppedEvents += normalized.value.dropped;
  }
  if (normalized.level === "trace") {
    const retained = boundedTail(trace, normalized.value.steps, limits.trace);
    trace = retained.values;
    traceOmitted += retained.omitted;
  }

  return freezeState({
    session: {
      ...current.session,
      status: inferStatus(current.session.status, normalized),
    },
    evidence: { metrics, events, trace },
    retention: {
      limits,
      eventsOmitted,
      traceOmitted,
      droppedEvents,
    },
    availability: {
      metrics: metrics != null,
      events: events.length > 0,
      trace: trace.length > 0,
    },
    capabilities: current.capabilities,
    selection: current.selection,
    diagnostics: current.diagnostics,
    metadata: current.metadata,
  });
}

export function selectExecutionState(state, selection) {
  const current = objectValue(state, "Hodos Dev Execution state");
  return freezeState({
    ...current,
    session: current.session,
    evidence: current.evidence,
    retention: current.retention,
    availability: current.availability,
    capabilities: current.capabilities,
    selection: selectionValue(selection),
    diagnostics: current.diagnostics,
    metadata: current.metadata,
  });
}

export function resetExecutionState(state) {
  const current = objectValue(state, "Hodos Dev Execution state");
  return createExecutionState({
    sessionId: current.session.id,
    status: current.session.id ? "connected" : "idle",
    limits: current.retention.limits,
    capabilities: current.capabilities,
    metadata: current.metadata,
  });
}

export function createExecutionArea({
  id = "execution/main",
  title = "Execution",
  state = createExecutionState(),
  evidence = [],
  events = HODOS_DEV_EXECUTION_EVENTS,
} = {}) {
  id = nonEmptyString(id, "Hodos Dev Execution area id");
  title = nonEmptyString(title, "Hodos Dev Execution title");
  if (!Array.isArray(evidence)) throw new TypeError("Hodos Dev Execution evidence must be an array");
  let model = state;
  for (const payload of evidence) model = ingestExecutionEvidence(model, payload);
  return Object.freeze({
    "area/id": id,
    "area/type": HODOS_DEV_EXECUTION_AREA_TYPE,
    "area/title": title,
    "area/component": Object.freeze({
      "component/id": HODOS_DEV_EXECUTION_COMPONENT_ID,
      "component/contract": WORKSPACE_COMPONENT_CONTRACT,
      "component/model": model,
      "component/events": Object.freeze([...events]),
    }),
  });
}
