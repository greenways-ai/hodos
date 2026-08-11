import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseEDNString } from "edn-data";
import {
  HARA_BYTECODE_METRICS_SCHEMA,
  createExecutionArea,
  createExecutionState,
} from "@greenways/hodos-dev";
import { createExecutionDomHost } from "../src/index.js";

const parseEdn = (source) => parseEDNString(source, {
  mapAs: "object",
  setAs: "array",
  listAs: "array",
  keywordAs: "string",
  charAs: "string",
  objectKeysAs: "string",
});

const token = (value) => String(value?.sym ?? value?.symbol ?? value?.name ?? value)
  .replace(/^:/, "");

const readEdn = async (relative) => parseEdn(await readFile(new URL(relative, import.meta.url), "utf8"));

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.dataset = {};
    this.className = "";
    this.listeners = new Map();
    this.textContent = "";
    this.disabled = false;
    this.value = 0;
    this.max = 0;
  }

  get childNodes() {
    return this.children;
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  addEventListener(type, listener, options = {}) {
    if (options?.signal?.aborted) return;
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
    if (options?.signal) {
      options.signal.addEventListener("abort", () => this.removeEventListener(type, listener), {
        once: true,
      });
    }
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry !== listener));
  }

  emit(type, detail = {}) {
    if (type === "click" && this.disabled) return;
    const event = { target: this, currentTarget: this, stopPropagation() {}, ...detail };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  contains(node) {
    if (node === this) return true;
    return this.children.some((child) => child.contains?.(node));
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
}

const walk = (node, result = []) => {
  result.push(node);
  for (const child of node.children ?? []) walk(child, result);
  return result;
};

const executionModel = (status) => createExecutionArea({
  state: createExecutionState({
    sessionId: "session/showcase",
    traceId: "trace/result-7",
    sourceId: "src/main.hal",
    documentSequence: { metrics: 7, events: 7, trace: 7 },
    status,
    metrics: {
      schema: HARA_BYTECODE_METRICS_SCHEMA,
      sessionId: "session/showcase",
      traceId: "trace/result-7",
      sourceId: "src/main.hal",
      sequence: 7,
      status,
      instructions: 7,
      opcodeCounts: { constant: 3, multiply: 1, add: 1, return: 1, enter: 1 },
      calls: 0,
      returns: 1,
      unwinds: 0,
      suspensions: 0,
      resumptions: 0,
      terminalReturns: 1,
      failures: 0,
      maxStackDepth: 3,
      maxCallDepth: 0,
    },
    compactEvents: [{
      id: "event/7",
      sequence: 7,
      kind: "terminal",
      terminal: "machine/return",
      function: 0,
      ip: 6,
      stackDepth: 1,
      callDepth: 0,
    }],
    traceSteps: [{
      id: "step/7",
      sequence: 7,
      kind: "machine/return",
      status: "ok",
      before: {
        status: "running",
        function: 0,
        ip: 6,
        stack: [{ kind: "number", display: "7" }],
        locals: [],
        calls: [],
        handlers: [],
      },
      after: {
        status: "returned",
        function: 0,
        ip: 6,
        stack: [{ kind: "number", display: "7" }],
        locals: [],
        calls: [],
        handlers: [],
        result: { kind: "number", display: "7" },
      },
      instruction: { opcode: "return", display: "return" },
      source: { sourceId: "src/main.hal", offset: 0, line: 1, column: 1 },
    }],
    selection: { eventIndex: 0 },
    capabilities: {
      start: true,
      step: true,
      run: true,
      pause: true,
      resume: true,
      reset: true,
      requestTrace: true,
    },
    metadata: {
      source: "(+ 1 (* 2 3))",
      result: "7",
      fixture: "execution/returned",
      runtime: "none",
    },
  }),
})["area/component"]["component/model"];

test("Execution Showcase publishes immutable deterministic model and host stories", async () => {
  const [modelManifest, hostManifest, returned, bounded, compact, suspended, failed, hostState] = await Promise.all([
    readEdn("../../dev/showcase.edn"),
    readEdn("../showcase.edn"),
    readEdn("../../dev/showcase/states/execution-returned.edn"),
    readEdn("../../dev/showcase/states/execution-bounded.edn"),
    readEdn("../../dev/showcase/states/execution-compact.edn"),
    readEdn("../../dev/showcase/states/execution-suspended.edn"),
    readEdn("../../dev/showcase/states/execution-failed.edn"),
    readEdn("../showcase/states/execution-host.edn"),
  ]);

  const stateIds = modelManifest["showcase/states"]
    .map((state) => token(state["state/id"]))
    .filter((id) => id.startsWith("execution/"));
  assert.deepEqual(stateIds, [
    "execution/idle",
    "execution/running",
    "execution/paused",
    "execution/suspended",
    "execution/returned",
    "execution/failed",
    "execution/bounded",
    "execution/compact",
  ]);

  assert.equal(returned.session.status, "returned");
  assert.equal(returned.metadata.source, "(+ 1 (* 2 3))");
  assert.equal(returned.metadata.result, "7");
  assert.equal(returned.evidence.metrics.schema, "hal.bytecode-metrics/0-alpha");
  assert.equal(returned.evidence.metrics.instructions > 0, true);
  assert.equal(returned.evidence.trace.at(-1).after.result.display, "7");
  assert.equal(returned.evidence.trace.at(-1).source.sourceId, "src/main.hal");
  assert.equal(bounded.retention.eventsOmitted > 0, true);
  assert.equal(bounded.retention.traceOmitted > 0, true);
  assert.equal(bounded.retention.droppedEvents > 0, true);
  assert.equal(bounded.retention.droppedTrace > 0, true);
  assert.equal(compact.metadata.viewport, "compact");
  assert.equal(suspended.session.status, "suspended");
  assert.equal(suspended.capabilities.resume, false);
  assert.equal(failed.session.status, "failed");
  assert.equal(failed.diagnostics[0].severity, "error");
  assert.deepEqual(hostState.host.dispose, ["abort-listeners", "clear-model", "owned-dom"]);
  assert.equal(hostState.authority.runtime, "hara");
  assert.equal(hostState.fixture.runtime, "none");

  const compactDemos = [
    ...modelManifest["showcase/demos"],
    ...hostManifest["showcase/demos"],
  ].filter((demo) => token(demo["demo/id"]).includes("compact"));
  assert.equal(compactDemos.length, 2);
  assert.deepEqual(compactDemos.map((demo) => demo["demo/viewport"]["viewport/width"]), [520, 520]);

  const [modelSource, hostSource, css] = await Promise.all([
    readFile(new URL("../../dev/showcase/execution/src/main.hal", import.meta.url), "utf8"),
    readFile(new URL("../showcase/execution-host/src/main.hal", import.meta.url), "utf8"),
    readFile(new URL("../src/execution.css", import.meta.url), "utf8"),
  ]);
  const inertSource = `${modelSource}\n${hostSource}`;
  for (const forbidden of [
    "bytecode-observation",
    "WebAssembly",
    "createBytecodeObservationRuntime",
    "session.run",
    "Machine::",
  ]) {
    assert.equal(inertSource.includes(forbidden), false, `Showcase must not contain ${forbidden}`);
  }
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /grid-template-columns: 1fr;/);
});

test("Execution Showcase host replaces listeners on update and disposes owned DOM", () => {
  const document = new FakeDocument();
  const container = new FakeElement("div", document);
  const events = [];
  const sourceEvents = [];
  let runtimeCalls = 0;
  const host = createExecutionDomHost({
    container,
    dispatch: (event) => events.push(event),
    dispatchSourceSelection: (event) => sourceEvents.push(event),
    services: {
      execution: {
        compile() { runtimeCalls += 1; },
        run() { runtimeCalls += 1; },
      },
    },
  });

  host.update(executionModel("connected"));
  const connectedNodes = walk(container);
  const oldStart = connectedNodes.find((node) => node.dataset?.action === "start");
  oldStart.emit("click");
  assert.deepEqual(events.map((event) => event["event/type"]), ["execution/start"]);
  assert.equal(connectedNodes.some((node) => node.textContent === "7"), true);

  host.update(executionModel("paused"));
  oldStart.emit("click");
  assert.deepEqual(events.map((event) => event["event/type"]), ["execution/start"]);

  const pausedNodes = walk(container);
  const pausedBoundary = pausedNodes.find((node) => node.dataset?.timelineIndex === "0");
  assert.equal(pausedNodes.find((node) => node.dataset?.action === "step").disabled, true);
  assert.equal(pausedNodes.find((node) => node.dataset?.action === "run").disabled, true);
  for (const action of ["resume", "reset", "request-trace"]) {
    pausedNodes.find((node) => node.dataset?.action === action).emit("click");
  }
  pausedBoundary.emit("click");

  assert.deepEqual(events.map((event) => event["event/type"]), [
    "execution/start",
    "execution/resume",
    "execution/reset",
    "execution/request-trace",
    "execution/select",
  ]);
  assert.equal(events.at(-1).source.sourceId, "src/main.hal");
  assert.deepEqual(sourceEvents, [{
    "event/type": "editor/selection",
    sourceId: "src/main.hal",
    start: 0,
    end: 0,
    source: { sourceId: "src/main.hal", offset: 0, line: 1, column: 1 },
    boundary: {
      function: 0,
      ip: 6,
      eventIndex: 0,
      traceIndex: 0,
    },
  }]);

  host.update(executionModel("returned"));
  pausedBoundary.emit("click");
  assert.equal(events.length, 5);
  const returnedReset = walk(container).find((node) => node.dataset?.action === "reset");

  host.dispose();
  returnedReset.emit("click");
  assert.equal(events.length, 5);
  assert.equal(sourceEvents.length, 1);
  assert.equal(runtimeCalls, 0);
  assert.equal(container.children.length, 0);
  assert.equal(container.dataset.hodosComponent, undefined);
  assert.throws(() => host.update(executionModel("idle")), /disposed/);
});
