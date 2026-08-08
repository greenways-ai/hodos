import assert from "node:assert/strict";
import test from "node:test";
import { createHodosComponentRegistry } from "@greenways/hodos-web";
import { createWorkspaceShellHost } from "../src/index.js";

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { for (const value of values) this.values.add(value); }
  remove(...values) { for (const value of values) this.values.delete(value); }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.className = "";
    this.listeners = new Map();
    this.hidden = false;
    this.tabIndex = -1;
    this.id = "";
    this.value = "";
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.scrollTop = 0;
    this.scrollLeft = 0;
  }

  get firstChild() { return this.children[0] ?? null; }
  get childNodes() { return this.children; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const index = this.parentNode.children.indexOf(this);
    return this.parentNode.children[index + 1] ?? null;
  }

  contains(node) {
    if (this === node) return true;
    return this.children.some((child) => child.contains?.(node));
  }

  append(...nodes) {
    for (const node of nodes) {
      node.remove?.();
      node.parentNode = this;
      this.children.push(node);
    }
  }

  appendChild(node) { this.append(node); return node; }

  replaceChildren(...nodes) {
    if (this.ownerDocument.activeElement && this.contains(this.ownerDocument.activeElement)) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
    }
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...nodes);
  }

  insertBefore(node, reference) {
    node.remove?.();
    const index = this.children.indexOf(reference);
    if (index < 0) {
      this.append(node);
      return node;
    }
    node.parentNode = this;
    this.children.splice(index, 0, node);
    return node;
  }

  removeChild(node) {
    if (this.ownerDocument.activeElement && node.contains?.(this.ownerDocument.activeElement)) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
    }
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  remove() { this.parentNode?.removeChild(this); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  getBoundingClientRect() { return { width: 900, height: 600 }; }
  setPointerCapture() {}
  releasePointerCapture() {}

  querySelectorAll(selector) {
    if (selector !== "[data-text-id]") return [];
    const output = [];
    const visit = (node) => {
      if (node.dataset?.textId) output.push(node);
      for (const child of node.children ?? []) visit(child);
    };
    visit(this);
    return output;
  }

  focus() { this.ownerDocument.activeElement = this; }
  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement("body", this);
    this.activeElement = this.body;
  }
  createElement(tagName) { return new FakeElement(tagName, this); }
  getElementById(id) {
    const visit = (node) => {
      if (node.id === id) return node;
      for (const child of node.children) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return visit(this.body);
  }
}

function workspace(source) {
  return {
    "workspace/id": "workspace/focus",
    "workspace/revision": source.length,
    "workspace/layout": {
      "layout/type": "area",
      "layout/area": "area/document",
    },
    "workspace/areas": [{
      "area/id": "area/document",
      "area/type": "hodos.2d/document",
      "area/title": "Document",
      "area/component": {
        "component/id": "probe/document",
        "component/model": { source },
        "component/events": ["document/edit-text"],
      },
    }],
    "workspace/selection": {
      "area/id": "area/document",
      "surface/id": "document",
    },
    "workspace/customizations": {
      "responsive/breakpoint": 900,
      "responsive/default-surface": "document",
      "responsive/surfaces": [{
        "surface/id": "document",
        "surface/area": "area/document",
        "surface/label": "Document",
      }],
    },
  };
}

test("Workspace shell restores the active text control after a canonical component update", () => {
  const document = new FakeDocument();
  const shellRoot = document.createElement("main");
  const areaRoot = document.createElement("section");
  document.body.append(shellRoot);
  shellRoot.append(areaRoot);

  let textarea = null;
  const registry = createHodosComponentRegistry();
  registry.register("probe/document", ({ root, model }) => {
    const render = (next) => {
      textarea = document.createElement("textarea");
      textarea.dataset.textId = "text/body";
      textarea.value = next.source;
      root.replaceChildren(textarea);
    };
    render(model);
    return {
      update(next) {
        render(next);
        textarea.focus();
        textarea.setSelectionRange(3, 3);
      },
    };
  });

  const host = createWorkspaceShellHost({
    root: shellRoot,
    registry,
    document,
    mode: "desktop",
    resolveAreaRoot: () => areaRoot,
  });

  host.mount(workspace("abc"));
  textarea.focus();
  textarea.setSelectionRange(3, 3);
  const first = textarea;

  host.update(workspace("abcd"));

  assert.notEqual(textarea, first, "the component host should have rendered a new control");
  assert.equal(document.activeElement, textarea);
  assert.equal(textarea.selectionStart, 3);
  assert.equal(textarea.selectionEnd, 3);
  assert.equal(textarea.value, "abcd");

  host.destroy();
});
