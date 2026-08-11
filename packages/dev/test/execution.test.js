import assert from "node:assert/strict";
import test from "node:test";
import {
  HARA_BYTECODE_EVENTS_SCHEMA,
  HARA_BYTECODE_METRICS_SCHEMA,
  HARA_BYTECODE_TRACE_SCHEMA,
  HODOS_DEV_EXECUTION_AREA_TYPE,
  HODOS_DEV_EXECUTION_COMPONENT_ID,
  createExecutionArea,
  createExecutionState,
  ingestExecutionEvidence,
  normalizeExecutionEvidence,
  resetExecutionState,
  selectExecutionState,
} from "../src/index.js";

const metrics = {
  schema: HARA_BYTECODE_METRICS_SCHEMA,
  instructions: 7,
  opcodeCounts: { constant: 3, primitive: 1, return: 1 },
  calls: 1,
  returns: 1,
  unwinds: 0,
  suspensions: 0,
  resumptions: 0,
  terminalReturns: 1,
  failures: 0,
  maxStackDepth: 3,
  maxCallDepth: 1,
};

const events = {
  schema: HARA_BYTECODE_EVENTS_SCHEMA,
  dropped: 4,
  events: [
    { kind: "instruction", function: 0, ip: 0, opcode: "constant", stackDepth: 0, callDepth: 0 },
    {
      kind: "transition",
      transition: "call/enter",
      fromFunction: 0,
      fromIp: 1,
      toFunction: 1,
      toIp: 0,
      stackDepth: 0,
      callDepth: 1,
    },
    { kind: "terminal", terminal: "machine/return", function: 0, ip: 4, stackDepth: 1, callDepth: 0 },
  ],
};

const trace = {
  schema: HARA_BYTECODE_TRACE_SCHEMA,
  steps: [
    {
      kind: "instruction/execute",
      status: "ok",
      before: { status: "running", function: 0, ip: 0 },
      after: { status: "running", function: 0, ip: 1 },
      source: { offset: 0, line: 1, column: 1 },
    },
    {
      kind: "machine/return",
      status: "ok",
      before: { status: "running", function: 0, ip: 4 },
      after: { status: "returned", function: 0, ip: 4 },
      source: { offset: 0, line: 1, column: 1 },
    },
  ],
};

test("execution state ingests bounded metrics, compact events and full traces", () => {
  let state = createExecutionState({
    sessionId: "execution/lesson",
    capabilities: {
      start: true,
      step: true,
      run: true,
      pause: true,
      resume: true,
      requestTrace: true,
    },
    limits: { events: 2, trace: 1, diagnostics: 2 },
  });
  state = ingestExecutionEvidence(state, metrics);
  state = ingestExecutionEvidence(state, events);
  state = ingestExecutionEvidence(state, trace);

  assert.equal(state.evidence.metrics.instructions, 7);
  assert.deepEqual(state.evidence.metrics.opcodeCounts, {
    constant: 3,
    primitive: 1,
    return: 1,
  });
  assert.equal(state.evidence.events.length, 2);
  assert.equal(state.retention.eventsOmitted, 1);
  assert.equal(state.retention.droppedEvents, 4);
  assert.equal(state.evidence.trace.length, 1);
  assert.equal(state.retention.traceOmitted, 1);
  assert.equal(state.session.status, "returned");
  assert.deepEqual(state.availability, { metrics: true, events: true, trace: true });
  assert.equal(state.capabilities.start, true);
  assert.equal(state.capabilities.step, true);
  assert.equal(state.capabilities.run, true);
  assert.equal(state.capabilities.requestTrace, true);
});

test("execution selection and area remain renderer-neutral serializable values", () => {
  let state = createExecutionState({ sessionId: "execution/lesson" });
  state = ingestExecutionEvidence(state, events);
  state = selectExecutionState(state, {
    function: 1,
    ip: 0,
    eventIndex: 0,
    source: { offset: 5, line: 1, column: 6 },
  });
  const area = createExecutionArea({ state });
  const component = area["area/component"];

  assert.equal(area["area/type"], HODOS_DEV_EXECUTION_AREA_TYPE);
  assert.equal(component["component/id"], HODOS_DEV_EXECUTION_COMPONENT_ID);
  assert.equal(component["component/contract"], "workspace.component/0-alpha");
  assert.equal(component["component/model"].selection.function, 1);
  assert.equal(component["component/events"].includes("execution/start"), true);
  assert.equal(component["component/events"].includes("execution/step"), true);
  assert.equal(component["component/events"].includes("execution/run"), true);
  assert.equal(component["component/events"].includes("execution/request-trace"), true);
  assert.equal(JSON.parse(JSON.stringify(area))["area/id"], "execution/main");
});

test("execution normalization fails closed and reset preserves session policy", () => {
  assert.equal(normalizeExecutionEvidence(metrics).level, "metrics");
  assert.throws(
    () => normalizeExecutionEvidence({ schema: "hal.bytecode-events/1", events: [] }),
    /Unsupported.*schema/,
  );
  assert.throws(
    () => normalizeExecutionEvidence({
      schema: HARA_BYTECODE_EVENTS_SCHEMA,
      events: [{ kind: "transition", transition: "agent/approve" }],
    }),
    /unsupported transition/,
  );
  assert.throws(
    () => createExecutionState({ status: "unknown" }),
    /Unsupported.*status/,
  );

  let state = createExecutionState({
    sessionId: "execution/lesson",
    capabilities: { requestTrace: true },
  });
  state = ingestExecutionEvidence(state, metrics);
  state = resetExecutionState(state);
  assert.equal(state.session.id, "execution/lesson");
  assert.equal(state.session.status, "connected");
  assert.equal(state.evidence.metrics, null);
  assert.equal(state.capabilities.requestTrace, true);
});

test("execution metrics accept Hara named opcode count projections", () => {
  const evidence = normalizeExecutionEvidence({
    schema: HARA_BYTECODE_METRICS_SCHEMA,
    instructions: 4,
    opcode_counts: [
      { opcode: "constant", count: 2 },
      { opcode: "return", count: 1 },
    ],
  });
  assert.equal(evidence.level, "metrics");
  assert.deepEqual(evidence.value.opcodeCounts, { constant: 2, return: 1 });
});
