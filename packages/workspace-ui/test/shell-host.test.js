import assert from "node:assert/strict";
import test from "node:test";
import { createHodosComponentRegistry } from "@greenways/hodos-web";
import { createWorkspaceShellHost } from "../src/index.js";

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { for (const value of values) this.values.add(value); }
  remove(...values) { for (const value of values) this.values.delete(value); }
  contains(value) { return this.values.has(value); }
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
    this.textContent = "";
    this.hidden = false;
    this.tabIndex = -1;
  }

  get firstChild() { return this.children[0] ?? null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const index = this.parentNode.children.indexOf(this);
    return this.parentNode.children[index + 1] ?? null;
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
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...nodes);
  }

  insertBefore(node, reference) {
    node.remove?.();
    const index = this.children.indexOf(reference);
    if (index < 0) return this.append(node);
    node.parentNode = this;
    this.children.splice(index, 0, node);
    return node;
  }

  removeChild(node) {
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

  emit(type, event = {}) {
    const value = {
      type,
      target: this,
      currentTarget: this,
      preventDefault() {},
      ...event,
    };
    for (const listener of this.listeners.get(type) ?? []) listener(value);
  }

  getBoundingClientRect() { return { width: 1000, height: 600 }; }
  setPointerCapture() {}
  releasePointerCapture() {}
  focus() { this.focused = true; }
}

class FakeDocument {
  createElement(tagName) { return new FakeElement(tagName, this); }
}

function descendants(root) {
  return [root, ...root.children.flatMap(descendants)];
}

function workspace(componentModel = 1) {
  return {
    "workspace/id": "workspace/test",
    "workspace/revision": componentModel,
    "workspace/layout": {
      "layout/type": "split",
      "layout/id": "layout/main",
      "layout/direction": "horizontal",
      "layout/ratio": 0.3,
      "layout/first": { "layout/type": "area", "layout/area": "area/files" },
      "layout/second": { "layout/type": "area", "layout/area": "area/editor" },
    },
    "workspace/areas": [
      { "area/id": "area/files", "area/type": "project", "area/title": "Files" },
      {
        "area/id": "area/editor",
        "area/type": "hodos.dev/editor",
        "area/title": "Code",
        "area/component": {
          "component/id": "probe/editor",
          "component/model": componentModel,
          "component/events": ["editor/change"],
        },
      },
    ],
    "workspace/selection": { "area/id": "area/editor", "surface/id": "code" },
    "workspace/customizations": {
      "responsive/breakpoint": 900,
      "responsive/default-surface": "code",
      "responsive/surfaces": [
        { "surface/id": "files", "surface/area": "area/files", "surface/label": "Files" },
        {
          "surface/id": "code",
          "surface/area": "area/editor",
          "surface/label": "Code",
          "surface/auto-focus": true,
        },
      ],
    },
  };
}

test("Workspace shell adopts roots, mounts components and renders recursive layout", () => {
  const document = new FakeDocument();
  const root = document.createElement("main");
  const files = document.createElement("section");
  const editor = document.createElement("section");
  root.append(files, editor);

  const lifecycle = [];
  const ratios = [];
  const registry = createHodosComponentRegistry();
  registry.register("probe/editor", ({ model }) => {
    lifecycle.push(["mount", model]);
    return {
      update(next) { lifecycle.push(["update", next]); },
      destroy() { lifecycle.push(["destroy"]); },
    };
  });

  const host = createWorkspaceShellHost({
    root,
    registry,
    document,
    mode: "desktop",
    resolveAreaRoot: (area) => area.id === "area/files" ? files : editor,
    services: {
      workspaceShell: {
        writeSplitRatio(value) { ratios.push(value); },
      },
    },
  });

  host.mount(workspace(1));
  assert.equal(host.currentMode(), "desktop");
  assert.equal(root.dataset.workspaceId, "workspace/test");
  assert.equal(root.dataset.workspaceMode, "desktop");
  assert.equal(files.dataset.workspaceAreaId, "area/files");
  assert.equal(editor.dataset.workspaceAreaId, "area/editor");
  assert.deepEqual(lifecycle, [["mount", 1]]);

  const divider = descendants(root).find((node) => node.getAttribute?.("role") === "separator");
  assert.ok(divider);
  divider.emit("keydown", { key: "ArrowRight" });
  assert.equal(ratios.at(-1).layoutId, "layout/main");
  assert.equal(ratios.at(-1).ratio, 0.32);

  host.update(workspace(2));
  assert.deepEqual(lifecycle, [["mount", 1], ["update", 2]]);

  host.destroy();
  assert.deepEqual(lifecycle, [["mount", 1], ["update", 2], ["destroy"]]);
  assert.deepEqual(root.children, [files, editor]);
});

test("Workspace shell compact dock routes selection and surface services", () => {
  const document = new FakeDocument();
  const root = document.createElement("main");
  const files = document.createElement("section");
  const editor = document.createElement("section");
  root.append(files, editor);

  const events = [];
  const activated = [];
  const focused = [];
  const registry = createHodosComponentRegistry();
  registry.register("probe/editor", () => ({ update() {} }));

  const host = createWorkspaceShellHost({
    root,
    registry,
    document,
    mode: "compact",
    resolveAreaRoot: (area) => area.id === "area/files" ? files : editor,
    dispatch: (event) => events.push(event),
    services: {
      workspaceShell: {
        activateSurface({ surface }) { activated.push(surface.id); },
        focusSurface({ surface, areaRoot }) {
          focused.push(surface.id);
          return areaRoot;
        },
      },
    },
  });

  host.mount(workspace());
  assert.equal(root.dataset.workspaceMode, "compact");
  assert.equal(root.dataset.workspaceSurfaceId, "code");
  assert.equal(host.currentSurface().id, "code");
  assert.equal(activated.at(-1), "code");

  const filesButton = descendants(root).find((node) => node.dataset?.workspaceSurfaceId === "files");
  assert.ok(filesButton);
  filesButton.emit("click");
  assert.equal(root.dataset.workspaceSurfaceId, "files");
  assert.deepEqual(events.at(-1), {
    "event/type": "workspace/area-select",
    "workspace/id": "workspace/test",
    "area/id": "area/files",
    "surface/id": "files",
  });
  assert.equal(activated.at(-1), "files");

  host.selectSurface("code", { focus: true });
  assert.equal(focused.at(-1), "code");
  assert.equal(editor.focused, true);
  host.destroy();
});

test("Workspace shell auto mode follows injected viewport width", () => {
  const document = new FakeDocument();
  const root = document.createElement("main");
  const files = document.createElement("section");
  const editor = document.createElement("section");
  root.append(files, editor);
  const registry = createHodosComponentRegistry();
  registry.register("probe/editor", () => ({}));
  const host = createWorkspaceShellHost({
    root,
    registry,
    document,
    resolveAreaRoot: (area) => area.id === "area/files" ? files : editor,
  });
  host.mount(workspace());
  host.setViewportWidth(1200);
  assert.equal(host.currentMode(), "desktop");
  host.setViewportWidth(600);
  assert.equal(host.currentMode(), "compact");
  host.destroy();
});
