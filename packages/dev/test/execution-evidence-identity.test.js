import assert from "node:assert/strict";
import test from "node:test";
import {
  HARA_BYTECODE_EVENTS_SCHEMA,
  HARA_BYTECODE_METRICS_SCHEMA,
  HARA_BYTECODE_TRACE_SCHEMA,
  createExecutionState,
  ingestExecutionEvidence,
  normalizeExecutionEvidence,
  selectExecutionState,
} from "../src/index.js";

const sessionId = "session/live";

const metricsDocument = ({
  traceId = "trace/a",
  sequence = 1,
  status = "running",
} = {}) => ({
  schema: HARA_BYTECODE_METRICS_SCHEMA,
  sessionId,
  traceId,
  sequence,
  status,
  instructions: sequence,
  opcodeCounts: { constant: sequence },
  calls: 0,
  returns: 0,
  unwinds: 0,
  suspensions: 0,
  resumptions: 0,
  terminalReturns: 0,
  failures: 0,
  maxStackDepth: 1,
  maxCallDepth: 0,
});

const instructionEvent = ({ id, sequence, ip, opcode = "constant" }) => ({
  id,
  sequence,
  kind: "instruction",
  function: 0,
  ip,
  opcode,
  stackDepth: 1,
  callDepth: 0,
});

const eventsDocument = ({
  traceId = "trace/a",
  sequence = 1,
  status = "running",
  dropped = 0,
  events = [],
} = {}) => ({
  schema: HARA_BYTECODE_EVENTS_SCHEMA,
  sessionId,
  traceId,
  sequence,
  status,
  dropped,
  events,
});

const traceStep = ({ id, sequence, offset, kind = "instruction/execute" }) => ({
  id,
  sequence,
  kind,
  status: "ok",
  before: { status: "running", function: 0, ip: sequence - 1 },
  after: {
    status: kind === "machine/return" ? "returned" : "running",
    function: 0,
    ip: sequence,
  },
  instruction: { opcode: "constant" },
  source: { sourceId: "src/live.hal", offset, line: 1, column: offset + 1 },
});

const traceDocument = ({
  traceId = "trace/a",
  sequence = 1,
  status = "running",
  dropped = 0,
  steps = [],
} = {}) => ({
  schema: HARA_BYTECODE_TRACE_SCHEMA,
  id: traceId,
  sessionId,
  sourceId: "src/live.hal",
  sequence,
  status,
  dropped,
  steps,
});

test("Execution normalization preserves live document, row and source identity", () => {
  const normalizedEvents = normalizeExecutionEvidence(eventsDocument({
    sequence: 8,
    dropped: 3,
    events: [instructionEvent({ id: "event/7", sequence: 7, ip: 2 })],
  }));
  assert.equal(normalizedEvents.value.sessionId, sessionId);
  assert.equal(normalizedEvents.value.traceId, "trace/a");
  assert.equal(normalizedEvents.value.sequence, 8);
  assert.equal(normalizedEvents.value.status, "running");
  assert.equal(normalizedEvents.value.dropped, 3);
  assert.equal(normalizedEvents.value.events[0].id, "event/7");
  assert.equal(normalizedEvents.value.events[0].sequence, 7);

  const normalizedTrace = normalizeExecutionEvidence(traceDocument({
    sequence: 9,
    dropped: 2,
    steps: [traceStep({ id: "step/8", sequence: 8, offset: 4 })],
  }));
  assert.equal(normalizedTrace.value.id, "trace/a");
  assert.equal(normalizedTrace.value.traceId, "trace/a");
  assert.equal(normalizedTrace.value.sessionId, sessionId);
  assert.equal(normalizedTrace.value.sourceId, "src/live.hal");
  assert.equal(normalizedTrace.value.sequence, 9);
  assert.equal(normalizedTrace.value.status, "running");
  assert.equal(normalizedTrace.value.dropped, 2);
  assert.equal(normalizedTrace.value.steps[0].id, "step/8");
  assert.equal(normalizedTrace.value.steps[0].sequence, 8);
  assert.equal(normalizedTrace.value.steps[0].source.sourceId, "src/live.hal");
});

test("Repeated retained event documents merge idempotently by stable ID", () => {
  let state = createExecutionState({
    sessionId,
    limits: { events: 8, trace: 8, diagnostics: 4 },
  });
  const first = eventsDocument({
    sequence: 2,
    dropped: 3,
    events: [
      instructionEvent({ id: "event/1", sequence: 1, ip: 0 }),
      instructionEvent({ id: "event/2", sequence: 2, ip: 1 }),
    ],
  });
  state = ingestExecutionEvidence(state, first);
  state = ingestExecutionEvidence(state, first);
  assert.deepEqual(state.evidence.events.map((event) => event.id), ["event/1", "event/2"]);
  assert.equal(state.retention.droppedEvents, 3);

  const laterRing = eventsDocument({
    sequence: 4,
    status: "paused",
    dropped: 5,
    events: [
      instructionEvent({ id: "event/2", sequence: 2, ip: 1, opcode: "add" }),
      instructionEvent({ id: "event/3", sequence: 3, ip: 2 }),
    ],
  });
  state = ingestExecutionEvidence(state, laterRing);
  state = ingestExecutionEvidence(state, laterRing);
  assert.deepEqual(
    state.evidence.events.map((event) => event.id),
    ["event/1", "event/2", "event/3"],
  );
  assert.equal(state.evidence.events.find((event) => event.id === "event/2").opcode, "add");
  assert.equal(state.retention.droppedEvents, 5);
  assert.equal(state.session.sequence.events, 4);
  assert.equal(state.session.status, "paused");
});

test("A new trace identity clears retained evidence and remains serializable", () => {
  let state = createExecutionState({
    sessionId,
    limits: { events: 8, trace: 8, diagnostics: 4 },
  });
  state = ingestExecutionEvidence(state, metricsDocument({ status: "ready" }));
  state = ingestExecutionEvidence(state, eventsDocument({
    sequence: 2,
    dropped: 1,
    events: [instructionEvent({ id: "event/a", sequence: 1, ip: 0 })],
  }));
  state = ingestExecutionEvidence(state, traceDocument({
    sequence: 3,
    dropped: 1,
    steps: [traceStep({ id: "step/a", sequence: 1, offset: 0 })],
  }));
  state = selectExecutionState(state, { eventIndex: 0, traceIndex: 0 });

  state = ingestExecutionEvidence(state, metricsDocument({
    traceId: "trace/b",
    sequence: 4,
    status: "ready",
  }));
  assert.equal(state.session.traceId, "trace/b");
  assert.equal(state.session.status, "connected");
  assert.deepEqual(state.evidence.events, []);
  assert.deepEqual(state.evidence.trace, []);
  assert.equal(state.retention.droppedEvents, 0);
  assert.equal(state.retention.droppedTrace, 0);
  assert.equal(state.selection.eventIndex, null);
  assert.equal(state.selection.traceIndex, null);

  const nextTrace = traceDocument({
    traceId: "trace/b",
    sequence: 5,
    status: "returned",
    dropped: 2,
    steps: [traceStep({ id: "step/b", sequence: 2, offset: 6, kind: "machine/return" })],
  });
  state = ingestExecutionEvidence(state, nextTrace);
  state = ingestExecutionEvidence(state, nextTrace);
  assert.deepEqual(state.evidence.trace.map((step) => step.id), ["step/b"]);
  assert.equal(state.retention.droppedTrace, 2);
  assert.equal(state.session.sourceId, "src/live.hal");
  assert.deepEqual(state.session.sequence, { metrics: 4, events: null, trace: 5 });
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);

  assert.throws(
    () => ingestExecutionEvidence(state, { ...metricsDocument(), sessionId: "session/other" }),
    /session identity mismatch/,
  );
});
