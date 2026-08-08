const STATUS_LABELS = Object.freeze({
  idle: "Idle",
  connected: "Ready",
  running: "Running",
  paused: "Paused",
  suspended: "Suspended",
  returned: "Completed",
  failed: "Failed",
});

const MAX_VISIBLE_ROWS = 64;

const objectValue = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
};

const safeObject = (value) => value && typeof value === "object" && !Array.isArray(value)
  ? value
  : {};
const safeArray = (value) => Array.isArray(value) ? value : [];
const stringValue = (value, fallback = "") => value == null ? fallback : String(value);
const numberValue = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
};
const optionalNumber = (value) => value == null ? null : numberValue(value, null);

const positionValue = (value) => {
  const position = safeObject(value);
  if (Object.keys(position).length === 0) return null;
  return Object.freeze({
    sourceId: position.sourceId == null ? null : String(position.sourceId),
    offset: optionalNumber(position.offset),
    line: optionalNumber(position.line),
    column: optionalNumber(position.column),
  });
};

const snapshotPosition = (snapshot) => ({
  function: optionalNumber(snapshot?.function),
  ip: optionalNumber(snapshot?.ip),
});

const tracePosition = (step) => {
  const before = safeObject(step?.before);
  const after = safeObject(step?.after);
  return {
    function: optionalNumber(before.function ?? after.function),
    ip: optionalNumber(before.ip ?? after.ip),
  };
};

const eventPosition = (event) => {
  if (event?.kind === "transition") {
    return {
      function: optionalNumber(event.toFunction ?? event.fromFunction),
      ip: optionalNumber(event.toIp ?? event.fromIp),
    };
  }
  return {
    function: optionalNumber(event?.function),
    ip: optionalNumber(event?.ip),
  };
};

const positionsEqual = (left, right) => left.function != null
  && right.function != null
  && left.ip != null
  && right.ip != null
  && left.function === right.function
  && left.ip === right.ip;

const traceIndexForEvent = (event, trace) => {
  const position = eventPosition(event);
  for (const [index, step] of trace.entries()) {
    if (positionsEqual(position, snapshotPosition(step?.before))) return index;
    if (positionsEqual(position, snapshotPosition(step?.after))) return index;
  }
  return null;
};

const eventLabel = (event) => {
  if (event.kind === "instruction") return event.opcode || "instruction";
  if (event.kind === "transition") return event.transition || "transition";
  if (event.kind === "terminal") return event.terminal || "terminal";
  return event.kind || "event";
};

const eventDetail = (event) => {
  if (event.kind === "transition") {
    return `f${numberValue(event.fromFunction)}:${numberValue(event.fromIp)} → f${numberValue(event.toFunction)}:${numberValue(event.toIp)}`;
  }
  const position = eventPosition(event);
  return position.function == null || position.ip == null
    ? "boundary"
    : `f${position.function}:${position.ip}`;
};

const traceLabel = (step) => stringValue(step?.kind, "trace boundary");

const sourceFromStep = (step) => positionValue(step?.source ?? step?.before?.source ?? step?.after?.source);

const sourceIdentity = (source, fallback) => {
  if (!source || source.sourceId != null || fallback == null) return source;
  return Object.freeze({ ...source, sourceId: String(fallback) });
};

const projectEventTimeline = (events, trace) => Object.freeze(events.map((event, index) => {
  const traceIndex = traceIndexForEvent(event, trace);
  const step = traceIndex == null ? null : trace[traceIndex];
  const position = eventPosition(event);
  return Object.freeze({
    key: `event/${index}`,
    kind: "event",
    index,
    traceIndex,
    label: eventLabel(event),
    detail: eventDetail(event),
    function: position.function,
    ip: position.ip,
    opcode: event.kind === "instruction" ? stringValue(event.opcode, "unknown") : null,
    source: sourceFromStep(step),
    event,
    step,
  });
}));

const projectTraceTimeline = (trace) => Object.freeze(trace.map((step, index) => {
  const position = tracePosition(step);
  return Object.freeze({
    key: `trace/${index}`,
    kind: "trace",
    index,
    traceIndex: index,
    label: traceLabel(step),
    detail: position.function == null || position.ip == null
      ? stringValue(step?.status, "boundary")
      : `f${position.function}:${position.ip}`,
    function: position.function,
    ip: position.ip,
    opcode: step?.instruction?.opcode == null ? null : String(step.instruction.opcode),
    source: sourceFromStep(step),
    event: null,
    step,
  });
}));

const selectedBoundary = (timeline, trace, selection) => {
  const selectedEvent = optionalNumber(selection.eventIndex);
  if (selectedEvent != null) {
    const match = timeline.find((item) => item.kind === "event" && item.index === selectedEvent);
    if (match) return match;
  }

  const selectedTrace = optionalNumber(selection.traceIndex);
  if (selectedTrace != null) {
    const match = timeline.find((item) => item.traceIndex === selectedTrace);
    if (match) return match;
    const step = trace[selectedTrace];
    if (step) {
      const projected = projectTraceTimeline([step])[0];
      return Object.freeze({
        ...projected,
        key: `trace/${selectedTrace}`,
        index: selectedTrace,
        traceIndex: selectedTrace,
      });
    }
  }

  const selectedPosition = {
    function: optionalNumber(selection.function),
    ip: optionalNumber(selection.ip),
  };
  if (selectedPosition.function != null && selectedPosition.ip != null) {
    const match = timeline.find((item) => positionsEqual(selectedPosition, item));
    if (match) return match;
  }

  return timeline.at(-1) ?? null;
};

const valueDisplay = (value) => {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && typeof value.display === "string") return value.display;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const listValue = (snapshot, key, omittedKey) => {
  const values = safeArray(snapshot?.[key]).slice(0, MAX_VISIBLE_ROWS).map(valueDisplay);
  const omitted = numberValue(snapshot?.[omittedKey], 0)
    + Math.max(0, safeArray(snapshot?.[key]).length - MAX_VISIBLE_ROWS);
  return Object.freeze({ values: Object.freeze(values), omitted });
};

const projectSnapshot = (snapshot) => {
  const value = safeObject(snapshot);
  return Object.freeze({
    status: stringValue(value.status, "unavailable"),
    function: optionalNumber(value.function),
    functionName: value.functionName == null ? null : String(value.functionName),
    ip: optionalNumber(value.ip),
    stack: listValue(value, "stack", "stackOmitted"),
    locals: listValue(value, "locals", "localsOmitted"),
    calls: listValue(value, "calls", "callsOmitted"),
    handlers: listValue(value, "handlers", "handlersOmitted"),
    result: value.result == null ? null : valueDisplay(value.result),
    error: value.error == null ? null : String(value.error),
  });
};

const controlsValue = (capabilities, status) => Object.freeze({
  start: Boolean(capabilities.start)
    && new Set(["idle", "connected", "returned", "failed"]).has(status),
  step: Boolean(capabilities.step) && new Set(["connected", "running"]).has(status),
  run: Boolean(capabilities.run) && new Set(["connected", "running"]).has(status),
  pause: Boolean(capabilities.pause) && status === "running",
  resume: Boolean(capabilities.resume) && (status === "paused" || status === "suspended"),
  reset: Boolean(capabilities.reset) && status !== "idle",
  requestTrace: Boolean(capabilities.requestTrace),
});

const diagnosticsValue = (diagnostics) => Object.freeze(safeArray(diagnostics).map((diagnostic, index) => {
  const value = safeObject(diagnostic);
  return Object.freeze({
    key: `${stringValue(value.code, "diagnostic")}/${index}`,
    code: value.code == null ? null : String(value.code),
    severity: stringValue(value.severity, "error"),
    message: stringValue(value.message, "Execution evidence is unavailable."),
  });
}));

const opcodeValues = (metrics) => {
  const counts = safeObject(metrics?.opcodeCounts);
  return Object.freeze(Object.entries(counts)
    .map(([opcode, count]) => Object.freeze({ opcode, count: numberValue(count) }))
    .sort((left, right) => right.count - left.count || left.opcode.localeCompare(right.opcode)));
};

/**
 * Projects a serializable Hodos Execution model into an inert DOM render plan.
 * The projection contains no runtime values, callbacks, promises or machine
 * handles; Hara execution remains owned by the application service.
 */
export function projectExecutionDomView(model) {
  const input = objectValue(model, "Hodos Dev Execution DOM model");
  const session = safeObject(input.session);
  const evidence = safeObject(input.evidence);
  const metrics = evidence.metrics == null ? null : safeObject(evidence.metrics);
  const events = safeArray(evidence.events);
  const trace = safeArray(evidence.trace);
  const selection = safeObject(input.selection);
  const status = stringValue(session.status, "idle");
  const metadataSourceId = input.metadata?.sourceId ?? input.metadata?.source?.id ?? null;
  const projectedTimeline = events.length > 0
    ? projectEventTimeline(events, trace)
    : projectTraceTimeline(trace);
  const timeline = Object.freeze(projectedTimeline.map((boundary) => Object.freeze({
    ...boundary,
    source: sourceIdentity(boundary.source, metadataSourceId),
  })));
  const selected = selectedBoundary(timeline, trace, selection);
  const selectedStep = selected?.step ?? null;
  const source = sourceIdentity(positionValue(selection.source) ?? selected?.source ?? null, metadataSourceId);
  const instructions = numberValue(metrics?.instructions, 0);
  const maxCallDepth = numberValue(metrics?.maxCallDepth, 0);

  return Object.freeze({
    componentId: "hodos.dev/execution",
    sessionId: session.id == null ? null : String(session.id),
    status,
    statusLabel: STATUS_LABELS[status] ?? status,
    summary: `${STATUS_LABELS[status] ?? status} · ${instructions.toLocaleString("en-US")} instructions · depth ${maxCallDepth}`,
    metrics: Object.freeze({
      instructions,
      calls: numberValue(metrics?.calls, 0),
      returns: numberValue(metrics?.returns, 0),
      unwinds: numberValue(metrics?.unwinds, 0),
      suspensions: numberValue(metrics?.suspensions, 0),
      resumptions: numberValue(metrics?.resumptions, 0),
      failures: numberValue(metrics?.failures, 0),
      maxStackDepth: numberValue(metrics?.maxStackDepth, 0),
      maxCallDepth,
      opcodeCounts: opcodeValues(metrics),
    }),
    retention: Object.freeze({
      eventsOmitted: numberValue(input.retention?.eventsOmitted, 0),
      traceOmitted: numberValue(input.retention?.traceOmitted, 0),
      droppedEvents: numberValue(input.retention?.droppedEvents, 0),
    }),
    timeline,
    selection: Object.freeze({
      eventIndex: optionalNumber(selection.eventIndex),
      traceIndex: optionalNumber(selection.traceIndex),
      function: optionalNumber(selection.function),
      ip: optionalNumber(selection.ip),
      source,
    }),
    selected: selected == null ? null : Object.freeze({
      ...selected,
      source,
      before: projectSnapshot(selectedStep?.before),
      after: projectSnapshot(selectedStep?.after),
      instruction: selectedStep?.instruction == null ? null : valueDisplay(selectedStep.instruction),
      error: selectedStep?.error == null ? null : String(selectedStep.error),
    }),
    controls: controlsValue(safeObject(input.capabilities), status),
    diagnostics: diagnosticsValue(input.diagnostics),
  });
}

