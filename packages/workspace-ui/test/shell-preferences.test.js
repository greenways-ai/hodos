import assert from "node:assert/strict";
import test from "node:test";
import { createHodosComponentRegistry } from "@greenways/hodos-web";
import {
  createWorkspaceShellHost,
  normalizeWorkspaceDescriptor,
} from "../src/index.js";

class ClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach((value) => this.values.add(value)); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); }
}

class Element {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.classList = new ClassList();
    this.listeners = new Map();
    this.attributes = new Map();
  }

  get firstChild() { return this.children[0] ?? null; }
  get nextSibling() {
    const index = this.parentNode?.children.indexOf(this) ?? -1;
    return index < 0 ? null : this.parentNode.children[index + 1] ?? null;
  }

  append(...children) {
    for (const child of children) {
      child.remove?.();
      child.parentNode = this;
      this.children.push(child);
    }
  }

  appendChild(child) { this.append(child); return child; }

  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...children);
  }

  insertBefore(child, reference) {
    child.remove?.();
    const index = this.children.indexOf(reference);
    if (index < 0) this.append(child);
    else {
      child.parentNode = this;
      this.children.splice(index, 0, child);
    }
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  remove() { this.parentNode?.removeChild(this); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener(type, listener) {
    const values = this.listeners.get(type) ?? new Set();
    values.add(listener);
    this.listeners.set(type, values);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  getBoundingClientRect() { return { width: 1000, height: 600 }; }
}

class Document {
  createElement() { return new Element(this); }
}

const descriptor = ({ surfaces, selection = { "area/id": "area/editor" } } = {}) => {
  const customizations = {};
  if (surfaces !== undefined) customizations["responsive/surfaces"] = surfaces;
  if (surfaces?.length) {
    customizations["responsive/default-surface"] = surfaces[1]?.["surface/id"]
      ?? surfaces[0]["surface/id"];
  }
  return {
    "workspace/id": "workspace/preferences",
    "workspace/layout": {
      "layout/type": "split",
      "layout/direction": "horizontal",
      "layout/ratio": 0.5,
      "layout/first": { "layout/type": "area", "layout/area": "area/files" },
      "layout/second": { "layout/type": "area", "layout/area": "area/editor" },
    },
    "workspace/areas": [
      { "area/id": "area/files", "area/type": "project", "area/title": "Files" },
      { "area/id": "area/editor", "area/type": "editor", "area/title": "Code" },
    ],
    "workspace/selection": selection,
    "workspace/customizations": customizations,
  };
};

const surfaces = [
  { "surface/id": "files", "surface/area": "area/files", "surface/label": "Files" },
  { "surface/id": "code", "surface/area": "area/editor", "surface/label": "Code" },
];

function fixture(options = {}) {
  const document = new Document();
  const root = new Element(document);
  const files = new Element(document);
  const editor = new Element(document);
  root.append(files, editor);
  const host = createWorkspaceShellHost({
    root,
    document,
    registry: createHodosComponentRegistry(),
    resolveAreaRoot: (area) => area.id === "area/files" ? files : editor,
    ...options,
  });
  return { document, root, files, editor, host };
}

test("an explicit empty responsive surface list remains empty", () => {
  const workspace = normalizeWorkspaceDescriptor(descriptor({ surfaces: [] }));
  assert.deepEqual(workspace.responsive.surfaces, []);
  assert.equal(workspace.responsive.defaultSurfaceId, null);
  assert.equal(workspace.selection.surfaceId, null);
});

test("the shell restores a persisted compact surface when the manifest does not select one", () => {
  const { root, host } = fixture({
    mode: "compact",
    services: {
      workspaceShell: {
        readSurface() { return "files"; },
      },
    },
  });
  host.mount(descriptor({ surfaces }));
  assert.equal(root.dataset.workspaceSurfaceId, "files");
  host.destroy();
});

test("the shell accepts an asynchronous compact-surface preference", async () => {
  const { root, host } = fixture({
    mode: "compact",
    services: {
      workspaceShell: {
        async readSurface() { return "files"; },
      },
    },
  });
  host.mount(descriptor({ surfaces }));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(root.dataset.workspaceSurfaceId, "files");
  host.destroy();
});

test("auto mode registers exactly one media-query listener API", () => {
  const calls = [];
  const media = {
    matches: false,
    addEventListener(type) { calls.push(["addEventListener", type]); },
    removeEventListener(type) { calls.push(["removeEventListener", type]); },
    addListener() { calls.push(["addListener"]); },
    removeListener() { calls.push(["removeListener"]); },
  };
  const { host } = fixture({ matchMedia: () => media });
  host.mount(descriptor({ surfaces }));
  host.destroy();
  assert.deepEqual(calls, [
    ["addEventListener", "change"],
    ["removeEventListener", "change"],
  ]);
});
