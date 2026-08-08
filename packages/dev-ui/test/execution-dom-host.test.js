import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  HARA_BYTECODE_METRICS_SCHEMA,
  createExecutionArea,
  createExecutionState,
} from "@greenways/hodos-dev";
import { createHodosComponentRegistry } from "@greenways/hodos-web";
import { createWorkspaceAreaHost } from "@greenways/hodos-workspace-ui";
import {
  createExecutionDomHost,
  projectExecutionDomView,
  registerHodosExecutionDomUi,
} from "../src/index.js";

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

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry !== listener));
  }

  emit(type, detail = {}) {
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

const executionModel = () => createExecutionArea({
  state: createExecutionState({
    sessionId: "execution/lesson",
    status: "running",
    metrics: {
      schema: HARA_BYTECODE_METRICS_SCHEMA,
      instructions: 7,
      opcodeCounts: { constant: 3, primitive: 2, return: 1 },
      calls: 1,
      returns: 1,
      unwinds: 0,
      suspensions: 0,
      resumptions: 0,
      failures: 0,
      maxStackDepth: 3,
      maxCallDepth: 1,
    },
    compactEvents: [
      {
        kind: "instruction",
        function: 0,
        ip: 0,
        opcode: "constant",
        stackDepth: 0,
        callDepth: 0,
      },
      {
        kind: "terminal",
        terminal: "machine/return",
        function: 0,
        ip: 4,
        stackDepth: 1,
        callDepth: 0,
      },
    ],
    traceSteps: [
      {
        kind: "instruction/execute",
        status: "ok",
        before: {
          status: "running",
          function: 0,
          ip: 0,
          stack: [],
          locals: [{ kind: "number", display: "1" }],
          calls: [],
          handlers: [],
        },
        after: {
          status: "running",
          function: 0,
          ip: 1,
          stack: [{ kind: "number", display: "1" }],
          locals: [{ kind: "number", display: "1" }],
          calls: [],
          handlers: [],
        },
        instruction: { opcode: "constant", display: "constant 1" },
        source: { sourceId: "example/core.hal", offset: 4, line: 1, column: 5 },
      },
      {
        kind: "machine/return",
        status: "ok",
        before: {
          status: "running",
          function: 0,
          ip: 4,
          stack: [{ kind: "number", display: "7" }],
          locals: [],
          calls: [],
          handlers: [],
        },
        after: {
          status: "returned",
          function: 0,
          ip: 4,
          stack: [{ kind: "number", display: "7" }],
          locals: [],
          calls: [],
          handlers: [],
          result: { kind: "number", display: "7" },
        },
        source: { sourceId: "example/core.hal", offset: 12, line: 1, column: 13 },
      },
    ],
    selection: { eventIndex: 0 },
    capabilities: { pause: true, resume: true, reset: true, requestTrace: true },
    diagnostics: [{
      code: "execution/sample",
      severity: "warning",
      message: "Sample execution diagnostic",
    }],
    metadata: { sourceId: "example/core.hal" },
  }),
})["area/component"]["component/model"];

test("Execution DOM projection remains inert and selects matching trace evidence", () => {
  const view = projectExecutionDomView(executionModel());
  assert.equal(view.sessionId, "execution/lesson");
  assert.equal(view.statusLabel, "Running");
  assert.equal(view.metrics.instructions, 7);
  assert.equal(view.timeline.length, 2);
  assert.equal(view.selected.label, "constant");
  assert.equal(view.selected.source.sourceId, "example/core.hal");
  assert.equal(view.selected.source.offset, 4);
  assert.deepEqual(view.selected.after.stack.values, ["1"]);
  assert.equal(view.controls.pause, true);
  assert.equal(view.controls.resume, false);
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.timeline), true);
});

test("Execution DOM host renders evidence and emits semantic controls and source selection", () => {
  const document = new FakeDocument();
  const container = new FakeElement("div", document);
  const events = [];
  const sourceEvents = [];
  const host = createExecutionDomHost({
    container,
    dispatch: (event) => events.push(event),
    dispatchSourceSelection: (event) => sourceEvents.push(event),
  });

  host.update(executionModel());
  const nodes = walk(container);
  assert.equal(container.dataset.hodosComponent, "hodos.dev/execution");
  assert.equal(nodes.some((node) => node.textContent === "7"), true);
  assert.equal(nodes.some((node) => node.textContent === "Opcode distribution"), true);
  assert.equal(nodes.some((node) => node.textContent === "Sample execution diagnostic"), true);

  const boundary = nodes.find((node) => node.dataset?.timelineIndex === "1");
  boundary.emit("click");
  nodes.find((node) => node.dataset?.action === "pause").emit("click");
  nodes.find((node) => node.dataset?.action === "request-trace").emit("click");

  assert.deepEqual(events.map((event) => event["event/type"]), [
    "execution/select",
    "execution/pause",
    "execution/request-trace",
  ]);
  assert.equal(events[0].eventIndex, 1);
  assert.equal(events[0].source.offset, 12);
  assert.deepEqual(sourceEvents, [{
    "event/type": "editor/selection",
    sourceId: "example/core.hal",
    start: 12,
    end: 12,
    source: {
      sourceId: "example/core.hal",
      offset: 12,
      line: 1,
      column: 13,
    },
    boundary: {
      function: 0,
      ip: 4,
      eventIndex: 1,
      traceIndex: 1,
    },
  }]);

  host.dispose();
  assert.equal(container.children.length, 0);
  assert.equal(container.dataset.hodosComponent, undefined);
});

test("Execution DOM registration supplies the concrete host without runtime ownership", () => {
  const document = new FakeDocument();
  const root = new FakeElement("div", document);
  const registry = createHodosComponentRegistry();
  const unregister = registerHodosExecutionDomUi(registry);
  const host = createWorkspaceAreaHost({ root, registry });

  host.open(createExecutionArea({ state: createExecutionState({ sessionId: "execution/lesson" }) }));
  assert.equal(root.dataset.hodosComponent, "hodos.dev/execution");
  host.destroy();
  unregister();
  assert.equal(root.children.length, 0);
  assert.equal(registry.has("hodos.dev/execution"), false);
});

test("Execution DOM source avoids HTML interpolation and executable evaluation", async () => {
  const source = await readFile(new URL("../src/execution-dom-host.js", import.meta.url), "utf8");
  assert.equal(source.includes("innerHTML"), false);
  assert.equal(source.includes("insertAdjacentHTML"), false);
  assert.equal(source.includes("new Function"), false);
  assert.equal(source.includes("eval("), false);
  assert.equal(source.includes("textContent"), true);
  assert.equal(source.includes("replaceChildren"), true);
  assert.equal(source.includes("AbortController"), true);
});
