import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkflowDomHost,
  projectWorkflowDomView,
  workflowEventFromGraph,
} from "../src/workflow-dom-host.js";

const registry = [
  { id: "sequence/validate", kind: "step", version: 1, capabilities: ["sequence.read"], label: "Validate sequence" },
  { id: "preview/render", kind: "step", version: 2, capabilities: ["preview.render"], label: "Render preview" },
  { id: "publication/intent", kind: "step", version: 1, capabilities: ["publication.intent"] },
];

const recipe = {
  schema: "std.work.recipe/0-alpha",
  "recipe/id": "sequence/publish",
  "recipe/version": 1,
  body: {
    op: "chain",
    id: "publish/body",
    children: [
      { op: "step-ref", id: "sequence/validate", uses: "sequence/validate" },
      { op: "step-ref", id: "preview/render", uses: "preview/render", params: { profile: "mobile" } },
      { op: "step-ref", id: "publication/intent", uses: "publication/intent" },
    ],
  },
};

const installedCapabilities = ["sequence.read", "preview.render", "publication.intent"];

function model(overrides = {}) {
  return {
    title: "Sequence publication",
    recipe,
    registry,
    installedCapabilities,
    capabilities: {
      select: true,
      moveNode: true,
      run: true,
      cancel: true,
      resume: true,
      fork: true,
    },
    ...overrides,
  };
}

test("projects a focused workflow view without introducing a UI scheduler", () => {
  const view = projectWorkflowDomView(model({ selection: { nodeId: "preview/render" } }));
  assert.equal(view.valid, true);
  assert.equal(view.recipeId, "sequence/publish");
  assert.equal(view.graph.nodes.length, 4);
  assert.equal(view.selected.nodeId, "preview/render");
  assert.equal(view.selected.operation.version, 2);
  assert.equal(view.commands.run, true);
  assert.equal(view.commands.cancel, false);
  assert.equal(view.graphModel.capabilities.connect, false);
  assert.equal(view.graphModel.capabilities.createNode, false);
});

test("running and checkpointed projections expose only valid runtime commands", () => {
  const running = projectWorkflowDomView(model({
    selection: { nodeId: "sequence/validate" },
    run: {
      id: "run-1",
      status: "running",
      nodes: {
        "sequence/validate": {
          status: "completed",
          replayed: true,
          checkpointId: "checkpoint-7",
          receiptStatus: "published",
        },
        "preview/render": { status: "running", attempt: 2 },
      },
    },
  }));
  assert.equal(running.commands.run, false);
  assert.equal(running.commands.cancel, true);
  assert.equal(running.commands.resume, false);
  assert.equal(running.commands.fork, true);
  assert.equal(running.selected.run.checkpointId, "checkpoint-7");

  const failed = projectWorkflowDomView(model({ run: { id: "run-2", status: "failed", nodes: {} } }));
  assert.equal(failed.commands.run, true);
  assert.equal(failed.commands.cancel, false);
  assert.equal(failed.commands.resume, true);
});

test("invalid recipes stay visible as diagnostics and cannot emit run commands", () => {
  const invalid = projectWorkflowDomView(model({
    recipe: {
      schema: "std.work.recipe/0-alpha",
      "recipe/id": "invalid",
      body: { op: "step-ref", id: "missing", uses: "missing/operation" },
    },
  }));
  assert.equal(invalid.valid, false);
  assert.equal(invalid.status, "error");
  assert.equal(invalid.graph.nodes.length, 0);
  assert.equal(invalid.commands.run, false);
  assert.ok(invalid.diagnostics.errors.some(({ code }) => code === "recipe/unknown-operation"));
});

test("graph gestures translate to stable recipe identities", () => {
  const view = projectWorkflowDomView(model());
  const preview = view.graph.nodes.find((node) => node.metadata.recipe.id === "preview/render");
  assert.deepEqual(
    workflowEventFromGraph({ "event/type": "graph/select", nodeIds: [preview.id] }, view),
    {
      "event/type": "workflow/select",
      recipeId: "sequence/publish",
      nodeId: "preview/render",
      nodeIds: ["preview/render"],
    },
  );
  assert.deepEqual(
    workflowEventFromGraph({ "event/type": "graph/move-node", nodeId: preview.id, x: 12, y: 34 }, view),
    {
      "event/type": "workflow/move-node",
      recipeId: "sequence/publish",
      nodeId: "preview/render",
      graphNodeId: preview.id,
      x: 12,
      y: 34,
    },
  );
  assert.equal(workflowEventFromGraph({ "event/type": "graph/connect" }, view), null);
});

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach((value) => this.values.add(value)); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); }
}

class FakeElement {
  constructor(document, tagName) {
    this.ownerDocument = document;
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.disabled = false;
    this.textContent = "";
    this.className = "";
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  setAttribute(name, value) { this[name] = value; }
  click() { this.listeners.get("click")?.({}); }
  findText(text) {
    if (this.textContent === text) return this;
    for (const child of this.children) {
      const found = child?.findText?.(text);
      if (found) return found;
    }
    return null;
  }
}

class FakeDocument {
  createElement(tagName) { return new FakeElement(this, tagName); }
}

test("the DOM host emits commands and delegates graph mechanics without executing work", () => {
  const document = new FakeDocument();
  const container = new FakeElement(document, "root");
  const events = [];
  let graphDispatch;
  let graphDestroyed = 0;
  const host = createWorkflowDomHost({
    container,
    dispatch: (event) => events.push(event),
    createGraphHost({ container: graphContainer, dispatch }) {
      graphDispatch = dispatch;
      return {
        update(value) { graphContainer.graphModel = value; },
        destroy() { graphDestroyed += 1; },
      };
    },
  });
  host.update(model({ selection: { nodeId: "sequence/validate" } }));
  assert.equal(container.dataset.hodosComponent, "hodos.flow/workflow");
  assert.ok(container.findText("Run"));
  container.findText("Run").click();
  assert.equal(events[0]["event/type"], "workflow/run");

  const preview = host.view().graph.nodes.find((node) => node.metadata.recipe.id === "preview/render");
  graphDispatch({ "event/type": "graph/select", nodeIds: [preview.id] });
  assert.equal(events.at(-1)["event/type"], "workflow/select");
  assert.equal(events.at(-1).nodeId, "preview/render");

  host.update(model({ run: { id: "run-1", status: "running", nodes: {} } }));
  container.findText("Cancel").click();
  assert.equal(events.at(-1)["event/type"], "workflow/cancel");
  assert.equal(events.at(-1).runId, "run-1");
  assert.equal(graphDestroyed, 1);

  host.dispose();
  assert.equal(graphDestroyed, 2);
  assert.equal(container.children.length, 0);
  assert.equal(container.dataset.hodosComponent, undefined);
});
