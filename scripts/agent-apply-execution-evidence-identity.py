from pathlib import Path
import re
import textwrap


def block(value: str) -> str:
    return textwrap.dedent(value).strip("\n")


def replace_regex(path: Path, pattern: str, replacement: str, *, marker: str, label: str) -> None:
    text = path.read_text()
    if marker in text:
        return
    resolved = block(replacement)
    updated, count = re.subn(pattern, lambda _match: resolved, text, count=1, flags=re.DOTALL)
    if count != 1:
        raise SystemExit(f"expected {label} block missing in {path}")
    path.write_text(updated)


def replace_once(path: Path, old: str, new: str, *, label: str) -> None:
    text = path.read_text()
    old = block(old)
    new = block(new)
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"expected {label} block missing in {path}")
    path.write_text(text.replace(old, new, 1))


execution = Path("packages/dev/src/execution.js")

replace_regex(
    execution,
    r"const optionalInteger = \(value, label\) => value == null\n  \? null\n  : nonNegativeInteger\(value, label\);",
    r'''
    const optionalInteger = (value, label) => value == null
      ? null
      : nonNegativeInteger(value, label);

    const documentIdentityValue = (value, label, { traceDocument = false } = {}) => {
      const traceId = value.traceId ?? value.trace_id ?? (traceDocument ? value.id : null);
      return Object.freeze({
        sessionId: optionalString(value.sessionId ?? value.session_id, `${label} session id`),
        traceId: optionalString(traceId, `${label} trace id`),
        sourceId: optionalString(value.sourceId ?? value.source_id, `${label} source id`),
        sequence: optionalInteger(value.sequence, `${label} sequence`),
        status: optionalString(value.status, `${label} status`),
      });
    };

    const projectedExecutionStatus = (value) => {
      if (value == null) return null;
      const status = nonEmptyString(value, "Hara bytecode evidence status");
      if (status === "ready") return "connected";
      if (status === "disposed") return "idle";
      return EXECUTION_STATUSES.has(status) ? status : null;
    };
    ''',
    marker="const documentIdentityValue =",
    label="identity helper",
)

replace_regex(
    execution,
    r"const positionValue = \(value, label\) => \{.*?\n\};(?=\n\nconst selectionValue)",
    r'''
    const positionValue = (value, label) => {
      if (value == null) return null;
      const position = objectValue(value, label);
      return Object.freeze({
        sourceId: optionalString(position.sourceId ?? position.source_id, `${label} source id`),
        offset: optionalInteger(position.offset, `${label} offset`),
        line: optionalInteger(position.line, `${label} line`),
        column: optionalInteger(position.column, `${label} column`),
      });
    };
    ''',
    marker="sourceId: optionalString(position.sourceId",
    label="source position",
)

replace_regex(
    execution,
    r"export function normalizeBytecodeMetrics\(payload\) \{.*?\n\}(?=\n\nconst instructionEventValue)",
    r'''
    export function normalizeBytecodeMetrics(payload) {
      const value = objectValue(payload, "Hara bytecode metrics");
      const schema = nonEmptyString(value.schema, "Hara bytecode metrics schema");
      if (schema !== HARA_BYTECODE_METRICS_SCHEMA) {
        throw new Error(`Unsupported Hara bytecode metrics schema: ${schema}`);
      }
      const identity = documentIdentityValue(value, "Hara bytecode metrics");
      return Object.freeze({
        schema,
        ...identity,
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
    ''',
    marker='const identity = documentIdentityValue(value, "Hara bytecode metrics")',
    label="metrics normalizer",
)

replace_regex(
    execution,
    r"const compactEventValue = \(event, index\) => \{.*?\n\}\n(?=\nconst traceStepValue)",
    r'''
    const compactEventValue = (event, index) => {
      const value = objectValue(event, `Hara bytecode event ${index}`);
      const kind = nonEmptyString(value.kind, `Hara bytecode event ${index} kind`);
      const label = `Hara bytecode event ${index}`;
      let projected;
      if (kind === "instruction") projected = instructionEventValue(value, label);
      else if (kind === "transition") projected = transitionEventValue(value, label);
      else if (kind === "terminal") projected = terminalEventValue(value, label);
      else throw new Error(`${label} has unsupported kind: ${kind}`);
      return Object.freeze({
        id: optionalString(value.id, `${label} id`),
        sequence: optionalInteger(value.sequence, `${label} sequence`),
        ...projected,
      });
    };

    export function normalizeBytecodeEvents(payload) {
      const value = objectValue(payload, "Hara bytecode events");
      const schema = nonEmptyString(value.schema, "Hara bytecode events schema");
      if (schema !== HARA_BYTECODE_EVENTS_SCHEMA) {
        throw new Error(`Unsupported Hara bytecode events schema: ${schema}`);
      }
      if (!Array.isArray(value.events)) throw new TypeError("Hara bytecode events must be an array");
      const identity = documentIdentityValue(value, "Hara bytecode events");
      return Object.freeze({
        schema,
        ...identity,
        events: Object.freeze(value.events.map(compactEventValue)),
        dropped: nonNegativeInteger(value.dropped ?? 0, "Hara bytecode dropped events"),
      });
    }
    ''',
    marker="id: optionalString(value.id, `${label} id`)",
    label="events normalizer",
)

replace_regex(
    execution,
    r"const traceStepValue = \(step, index\) => \{.*?\n\}\n(?=\nexport function normalizeExecutionEvidence)",
    r'''
    const traceStepValue = (step, index) => {
      const value = objectValue(step, `Hara bytecode trace step ${index}`);
      const before = serializableValue(value.before ?? {}, `Hara bytecode trace step ${index} before`);
      const after = serializableValue(value.after ?? {}, `Hara bytecode trace step ${index} after`);
      return Object.freeze({
        id: optionalString(value.id, `Hara bytecode trace step ${index} id`),
        sequence: optionalInteger(value.sequence, `Hara bytecode trace step ${index} sequence`),
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
      const identity = documentIdentityValue(value, "Hara bytecode trace", { traceDocument: true });
      return Object.freeze({
        schema,
        id: optionalString(value.id ?? identity.traceId, "Hara bytecode trace id"),
        ...identity,
        steps: Object.freeze(steps.map(traceStepValue)),
        dropped: nonNegativeInteger(value.dropped ?? 0, "Hara bytecode dropped trace steps"),
      });
    }
    ''',
    marker="Hara bytecode dropped trace steps",
    label="trace normalizer",
)

replace_regex(
    execution,
    r"const boundedTail = \(current, added, limit\) => \{.*?\n\};(?=\n\nconst freezeState)",
    r'''
    const stableEvidenceKey = (value) => {
      if (value.id != null) return `id/${value.id}`;
      if (value.sequence != null) return `sequence/${value.kind}/${value.sequence}`;
      return `legacy/${JSON.stringify(value)}`;
    };

    const compareEvidence = (left, right) => {
      const leftSequence = left.sequence ?? Number.MAX_SAFE_INTEGER;
      const rightSequence = right.sequence ?? Number.MAX_SAFE_INTEGER;
      if (leftSequence !== rightSequence) return leftSequence - rightSequence;
      return String(left.id ?? "").localeCompare(String(right.id ?? ""));
    };

    const boundedEvidence = (current, added, limit) => {
      const byIdentity = new Map();
      for (const value of [...current, ...added]) {
        byIdentity.set(stableEvidenceKey(value), value);
      }
      const combined = [...byIdentity.values()].sort(compareEvidence);
      const omitted = Math.max(0, combined.length - limit);
      return Object.freeze({
        values: Object.freeze(combined.slice(omitted)),
        omitted,
      });
    };

    const inferStatus = (status, evidence) => {
      const explicit = projectedExecutionStatus(evidence.value.status);
      if (explicit != null) return explicit;
      if (evidence.level === "events") {
        const last = evidence.value.events.at(-1);
        if (last?.kind === "terminal") return last.terminal === "machine/fail" ? "failed" : "returned";
        if (last?.kind === "transition" && last.transition === "machine/suspend") return "suspended";
        if (last?.kind === "transition" && last.transition === "machine/resume") return "running";
        if (evidence.value.events.length > 0) return "running";
      }
      if (evidence.level === "trace") {
        const last = evidence.value.steps.at(-1);
        const projected = projectedExecutionStatus(last?.after?.status);
        if (projected != null) return projected;
        if (last?.kind === "machine/fail") return "failed";
        if (last?.kind === "machine/return") return "returned";
        if (evidence.value.steps.length > 0) return "running";
      }
      return status;
    };
    ''',
    marker="const boundedEvidence =",
    label="identity-safe retention",
)

replace_regex(
    execution,
    r"export function createExecutionState\(\{.*?\n\}(?=\n\nexport function ingestExecutionEvidence)",
    r'''
    export function createExecutionState({
      sessionId = null,
      traceId = null,
      sourceId = null,
      documentSequence = {},
      status = null,
      metrics = null,
      compactEvents = [],
      traceSteps = [],
      eventsOmitted = 0,
      traceOmitted = 0,
      droppedEvents = 0,
      droppedTrace = 0,
      selection = {},
      capabilities = {},
      limits = {},
      diagnostics = [],
      metadata = {},
    } = {}) {
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
      const normalizedDocumentSequence = objectValue(
        documentSequence,
        "Hodos Dev Execution document sequence",
      );
      const retainedEvents = boundedEvidence(
        [],
        compactEvents.map(compactEventValue),
        normalizedLimits.events,
      );
      const retainedTrace = boundedEvidence(
        [],
        traceSteps.map(traceStepValue),
        normalizedLimits.trace,
      );
      const retainedDiagnostics = diagnostics.map(diagnosticValue).slice(-normalizedLimits.diagnostics);
      const normalizedMetrics = metrics == null ? null : normalizeBytecodeMetrics(metrics);
      const normalizedSessionId = optionalString(
        sessionId ?? normalizedMetrics?.sessionId,
        "Hodos Dev Execution session id",
      );
      const normalizedTraceId = optionalString(
        traceId ?? normalizedMetrics?.traceId,
        "Hodos Dev Execution trace id",
      );
      const normalizedSourceId = optionalString(
        sourceId ?? normalizedMetrics?.sourceId,
        "Hodos Dev Execution source id",
      );
      const resolvedStatus = status
        ?? projectedExecutionStatus(normalizedMetrics?.status)
        ?? (normalizedSessionId ? "connected" : "idle");
      const normalizedStatus = nonEmptyString(resolvedStatus, "Hodos Dev Execution status");
      if (!EXECUTION_STATUSES.has(normalizedStatus)) {
        throw new Error(`Unsupported Hodos Dev Execution status: ${normalizedStatus}`);
      }
      return freezeState({
        session: {
          id: normalizedSessionId,
          traceId: normalizedTraceId,
          sourceId: normalizedSourceId,
          sequence: Object.freeze({
            metrics: optionalInteger(
              normalizedDocumentSequence.metrics ?? normalizedMetrics?.sequence,
              "Hodos Dev Execution metrics document sequence",
            ),
            events: optionalInteger(
              normalizedDocumentSequence.events,
              "Hodos Dev Execution events document sequence",
            ),
            trace: optionalInteger(
              normalizedDocumentSequence.trace,
              "Hodos Dev Execution trace document sequence",
            ),
          }),
          status: normalizedStatus,
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
          droppedTrace: nonNegativeInteger(droppedTrace, "Hodos Dev Execution dropped trace steps"),
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
    ''',
    marker="documentSequence = {}",
    label="Execution state constructor",
)

replace_regex(
    execution,
    r"export function ingestExecutionEvidence\(state, payload\) \{.*?\n\}(?=\n\nexport function selectExecutionState)",
    r'''
    export function ingestExecutionEvidence(state, payload) {
      const current = objectValue(state, "Hodos Dev Execution state");
      const normalized = normalizeExecutionEvidence(payload);
      const limits = current.retention.limits;
      const evidenceSessionId = normalized.value.sessionId;
      if (
        current.session.id != null
        && evidenceSessionId != null
        && current.session.id !== evidenceSessionId
      ) {
        throw new Error(
          `Hodos Dev Execution session identity mismatch: ${current.session.id} != ${evidenceSessionId}`,
        );
      }

      const currentTraceId = current.session.traceId ?? null;
      const evidenceTraceId = normalized.value.traceId ?? null;
      const traceChanged = currentTraceId != null
        && evidenceTraceId != null
        && currentTraceId !== evidenceTraceId;

      let metrics = traceChanged ? null : current.evidence.metrics;
      let events = traceChanged ? Object.freeze([]) : current.evidence.events;
      let trace = traceChanged ? Object.freeze([]) : current.evidence.trace;
      let eventsOmitted = traceChanged ? 0 : current.retention.eventsOmitted;
      let traceOmitted = traceChanged ? 0 : current.retention.traceOmitted;
      let droppedEvents = traceChanged ? 0 : current.retention.droppedEvents;
      let droppedTrace = traceChanged ? 0 : (current.retention.droppedTrace ?? 0);
      const selection = traceChanged ? selectionValue() : current.selection;
      const documentSequence = traceChanged
        ? { metrics: null, events: null, trace: null }
        : {
            metrics: current.session.sequence?.metrics ?? null,
            events: current.session.sequence?.events ?? null,
            trace: current.session.sequence?.trace ?? null,
          };

      if (normalized.value.sequence != null) {
        const previous = documentSequence[normalized.level];
        documentSequence[normalized.level] = previous == null
          ? normalized.value.sequence
          : Math.max(previous, normalized.value.sequence);
      }
      if (normalized.level === "metrics") metrics = normalized.value;
      if (normalized.level === "events") {
        const retained = boundedEvidence(events, normalized.value.events, limits.events);
        events = retained.values;
        eventsOmitted = Math.max(eventsOmitted, retained.omitted);
        droppedEvents = Math.max(droppedEvents, normalized.value.dropped);
      }
      if (normalized.level === "trace") {
        const retained = boundedEvidence(trace, normalized.value.steps, limits.trace);
        trace = retained.values;
        traceOmitted = Math.max(traceOmitted, retained.omitted);
        droppedTrace = Math.max(droppedTrace, normalized.value.dropped);
      }

      return freezeState({
        session: {
          id: current.session.id ?? evidenceSessionId,
          traceId: evidenceTraceId ?? currentTraceId,
          sourceId: normalized.value.sourceId
            ?? (traceChanged ? null : current.session.sourceId ?? null),
          sequence: Object.freeze(documentSequence),
          status: inferStatus(current.session.status, normalized),
        },
        evidence: { metrics, events, trace },
        retention: {
          limits,
          eventsOmitted,
          traceOmitted,
          droppedEvents,
          droppedTrace,
        },
        availability: {
          metrics: metrics != null,
          events: events.length > 0,
          trace: trace.length > 0,
        },
        capabilities: current.capabilities,
        selection,
        diagnostics: current.diagnostics,
        metadata: current.metadata,
      });
    }
    ''',
    marker="Hodos Dev Execution session identity mismatch",
    label="Execution evidence ingestion",
)

execution_hal = Path("packages/dev/src/gw/hodos/dev/execution.hal")
replace_once(
    execution_hal,
    r'''
    {:session session
     :evidence evidence
     :retention (get options :retention
                     {:limits {:events 512 :trace 128 :diagnostics 64}
                      :eventsOmitted 0
                      :traceOmitted 0
                      :droppedEvents 0})
    ''',
    r'''
    {:session (merge {:traceId nil
                      :sourceId nil
                      :sequence {:metrics nil :events nil :trace nil}}
                     session)
     :evidence evidence
     :retention (get options :retention
                     {:limits {:events 512 :trace 128 :diagnostics 64}
                      :eventsOmitted 0
                      :traceOmitted 0
                      :droppedEvents 0
                      :droppedTrace 0})
    ''',
    label="Hara Execution identity defaults",
)

# Make the existing concrete-host test prove evidence source identity wins over metadata fallback.
dom_test = Path("packages/dev-ui/test/execution-dom-host.test.js")
replace_once(
    dom_test,
    '    metadata: { sourceId: "example/core.hal" },',
    '    metadata: { sourceId: "fallback/core.hal" },',
    label="Execution DOM source fallback fixture",
)

identity_test = Path("packages/dev/test/execution-evidence-identity.test.js")
identity_test.write_text(block(r'''
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
''') + "\n")

dev_readme = Path("packages/dev/README.md")
replace_once(
    dev_readme,
    r'''
    hal.bytecode-trace/v1    exact single-step state projections
    ```

    ```js
    ''',
    r'''
    hal.bytecode-trace/v1    exact single-step state projections
    ```

    Live documents retain their session, trace, source, sequence, status and
    cumulative dropped-count identity. Compact events and trace steps retain stable
    IDs and sequences, so polling a retained Hara ring repeatedly replaces matching
    rows, preserves sequence order and bounds only after deduplication. A new trace
    identity clears evidence from the previous trace rather than mixing sessions.

    ```js
    ''',
    label="Execution evidence identity documentation",
)

ui_readme = Path("packages/dev-ui/README.md")
replace_once(
    ui_readme,
    r'''
    also emits a serializable `editor/selection` event to the application
    compositor. Hodos does not manipulate the editor directly.
    ''',
    r'''
    also emits a serializable `editor/selection` event to the application
    compositor. The source identity carried by the selected trace boundary remains
    authoritative; model metadata is only a fallback when evidence has no source ID.
    Hodos does not manipulate the editor directly.
    ''',
    label="Execution DOM source identity documentation",
)
