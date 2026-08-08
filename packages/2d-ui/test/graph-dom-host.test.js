import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createGraphArea } from "@greenways/hodos-2d";
import {
  createGraphDomHost,
  projectGraphDomView,
} from "../src/graph-dom-host.js";

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { for (const value of values) this.values.add(value); }
  remove(...values) { for (const value of values) this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.dataset = {};
    this.className = "";
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.attributes = new Map();
    this.style = {};
    this.textContent = "";
    this.disabled = false;
    this.type = "";
  }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry !== listener));
  }
  emit(type, detail = {}) {
    const event = {
      target: this,
      currentTarget: this,
      stopPropagation() {},
      preventDefault() {},
      ...detail,
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  contains(node) { return node === this || this.children.some((child) => child.contains?.(node)); }
  setPointerCapture() {}
  releasePointerCapture() {}
}

class FakeDocument {
  createElement(tagName) { return new FakeElement(tagName, this); }
  createElementNS(_namespace, tagName) { return new FakeElement(tagName, this); }
}

const walk = (node, result = []) => {
  result.push(node);
  for (const child of node.children ?? []) walk(child, result);
  return result;
};

const model = () => createGraphArea({
  graph: {
    id: "graph/main",
    revision: 2,
    metadata: { title: "Flow" },
    nodes: [{
      id: "node/source",
      type: "source",
      label: "Source",
      x: 20,
      y: 40,
      width: 160,
      height: 96,
      ports: [{ id: "out:0", direction: "out", dataType: "number", label: "value" }],
    }, {
      id: "node/target",
      type: "target",
      label: "Target",
      x: 360,
      y: 180,
      width: 170,
      height: 96,
      ports: [{ id: "in:0", direction: "in", dataType: "number", label: "value" }],
    }],
    connections: [{
      id: "connection/main",
      from: { nodeId: "node/source", portId: "out:0" },
      to: { nodeId: "node/target", portId: "in:0" },
    }],
  },
  selection: { nodeIds: [], connectionIds: [] },
  viewport: { x: 0, y: 0, zoom: 1 },
  capabilities: {
    select: true,
    moveNode: true,
    connect: true,
    createNode: true,
    delete: true,
    command: true,
  },
})["area/component"]["component/model"];

test("Graph DOM projection creates stable nodes, ports and SVG paths", () => {
  const view = projectGraphDomView(model());
  assert.equal(view.id, "graph/main");
  assert.equal(view.nodes.length, 2);
  assert.equal(view.connections.length, 1);
  assert.match(view.connections[0].path, /^M /);
  assert.equal(view.nodes[0].ports[0].direction, "out");
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.nodes), true);
});

test("Graph DOM host emits selection, move and connection semantics", () => {
  const document = new FakeDocument();
  const container = new FakeElement("div", document);
  const events = [];
  const host = createGraphDomHost({
    container,
    dispatch: (event) => events.push(event),
  });
  host.update(model());
  const nodes = walk(container);
  assert.equal(container.dataset.hodosComponent, "hodos.2d/graph");
  assert.equal(nodes.some((node) => node.tagName === "SVG"), true);

  const source = nodes.find((node) => node.dataset?.nodeId === "node/source" && node.tagName === "ARTICLE");
  const handle = nodes.find((node) => node.dataset?.graphDragHandle === "node/source");
  assert.ok(source);
  assert.ok(handle);
  handle.emit("pointerdown", { button: 0, pointerId: 7, clientX: 10, clientY: 20 });
  handle.emit("pointermove", { pointerId: 7, clientX: 50, clientY: 60 });
  handle.emit("pointerup", { pointerId: 7, clientX: 50, clientY: 60 });

  const output = nodes.find((node) => node.dataset?.nodeId === "node/source" && node.dataset?.portId === "out:0");
  const input = nodes.find((node) => node.dataset?.nodeId === "node/target" && node.dataset?.portId === "in:0");
  output.emit("click");
  input.emit("click");

  const connection = nodes.find((node) => node.dataset?.connectionId === "connection/main");
  connection.emit("click");

  assert.deepEqual(events.map((event) => event["event/type"]), [
    "graph/select",
    "graph/move-node",
    "graph/connect",
    "graph/select",
  ]);
  assert.deepEqual(events[1], {
    "event/type": "graph/move-node",
    graphId: "graph/main",
    nodeId: "node/source",
    x: 60,
    y: 80,
  });
  assert.deepEqual(events[2], {
    "event/type": "graph/connect",
    graphId: "graph/main",
    from: { nodeId: "node/source", portId: "out:0" },
    to: { nodeId: "node/target", portId: "in:0" },
  });
  assert.equal(source.style.left, "140px");
  assert.equal(connection.attributes.get("d").startsWith("M "), true);

  host.dispose();
  assert.equal(container.children.length, 0);
  assert.equal(container.dataset.hodosComponent, undefined);
});

test("Graph DOM source avoids HTML interpolation and executable evaluation", async () => {
  const source = await readFile(new URL("../src/graph-dom-host.js", import.meta.url), "utf8");
  assert.equal(source.includes("innerHTML"), false);
  assert.equal(source.includes("insertAdjacentHTML"), false);
  assert.equal(source.includes("new Function"), false);
  assert.equal(source.includes("eval("), false);
  assert.equal(source.includes("createElementNS"), true);
  assert.equal(source.includes("textContent"), true);
  assert.equal(source.includes("AbortController"), true);
});
