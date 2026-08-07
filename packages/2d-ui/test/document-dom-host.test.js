import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createDocumentArea } from "@greenways/hodos-2d";
import {
  createDocumentDomHost,
  projectDocumentDomView,
} from "../src/document-dom-host.js";

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.values = new Set();
  }

  add(...values) {
    for (const value of values) this.values.add(value);
  }

  remove(...values) {
    for (const value of values) this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.dataset = {};
    this.className = "";
    this.classList = new FakeClassList(this);
    this.listeners = new Map();
    this.attributes = new Map();
    this.textContent = "";
    this.value = "";
    this.disabled = false;
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

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  contains(node) {
    if (node === this) return true;
    return this.children.some((child) => child.contains?.(node));
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }
}

class FakeDocument {
  constructor() {
    this.activeElement = null;
    this.defaultView = { getSelection: () => null };
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
}

const walk = (node, result = []) => {
  result.push(node);
  for (const child of node.children ?? []) walk(child, result);
  return result;
};

const areaModel = () => createDocumentArea({
  document: {
    profile: "hodos.rich-text/2",
    id: "document/main",
    title: "Hodos document",
    revision: 3,
    children: [{
      id: "block/heading",
      type: "heading",
      attrs: { level: 2 },
      children: [{ id: "text/heading", type: "text", text: "Hello" }],
    }, {
      id: "block/artefact",
      type: "hara-artefact",
      attrs: {
        artefactId: "artefact/value",
        kind: "value",
        title: "Answer",
        mode: "snapshot",
        capabilities: [],
        snapshotDisplay: "42",
      },
      children: [{ id: "text/source", type: "text", text: "(* 6 7)" }],
    }],
  },
  selection: { nodeId: "block/heading" },
  capabilities: {
    select: true,
    editText: true,
    insertBlock: true,
    deleteBlock: true,
    activateArtefact: true,
    commitArtefact: true,
  },
})["area/component"]["component/model"];

test("Document DOM projection remains inert and descriptive", () => {
  const view = projectDocumentDomView(areaModel());
  assert.equal(view.id, "document/main");
  assert.equal(view.blocks[0].tag, "h2");
  assert.equal(view.blocks[0].texts[0].text, "Hello");
  assert.equal(view.blocks[1].attrs.snapshotDisplay, "42");
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.blocks), true);
});

test("Document DOM host renders safe nodes and emits semantic events", () => {
  const document = new FakeDocument();
  const container = new FakeElement("div", document);
  const events = [];
  const host = createDocumentDomHost({
    container,
    dispatch: (event) => events.push(event),
  });

  host.update(areaModel());
  const nodes = walk(container);
  assert.equal(container.dataset.hodosComponent, "hodos.2d/document");
  assert.equal(nodes.some((node) => node.tagName === "H2"), true);
  assert.equal(nodes.some((node) => node.textContent === "42"), true);

  const heading = nodes.find((node) => node.dataset?.nodeId === "block/heading");
  heading.emit("pointerdown");
  const text = nodes.find((node) => node.dataset?.textId === "text/heading");
  text.textContent = "Hello world";
  text.emit("input");
  const paragraph = nodes.find((node) => node.textContent === "Paragraph");
  paragraph.emit("click");

  assert.deepEqual(events.map((event) => event["event/type"]), [
    "document/select",
    "document/edit-text",
    "document/insert-block",
  ]);
  assert.equal(events[1].textId, "text/heading");
  assert.equal(events[1].previous, "Hello");
  assert.equal(events[1].text, "Hello world");

  host.dispose();
  assert.equal(container.children.length, 0);
  assert.equal(container.dataset.hodosComponent, undefined);
});

test("Document DOM source avoids HTML interpolation and executable evaluation", async () => {
  const source = await readFile(new URL("../src/document-dom-host.js", import.meta.url), "utf8");
  assert.equal(source.includes("innerHTML"), false);
  assert.equal(source.includes("insertAdjacentHTML"), false);
  assert.equal(source.includes("new Function"), false);
  assert.equal(source.includes("eval("), false);
  assert.equal(source.includes("textContent"), true);
  assert.equal(source.includes("replaceChildren"), true);
  assert.equal(source.includes("AbortController"), true);
});
