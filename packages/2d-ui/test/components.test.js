import assert from "node:assert/strict";
import test from "node:test";
import {
  createDocumentArea,
  createGraphArea,
} from "@greenways/hodos-2d";
import { createHodosComponentRegistry } from "@greenways/hodos-web";
import { createWorkspaceAreaHost } from "@greenways/hodos-workspace-ui";
import {
  registerHodos2dUi,
  registerHodosDocumentUi,
} from "../src/index.js";

const document = {
  profile: "hodos.rich-text/0-alpha",
  id: "document/main",
  children: [{
    id: "block/main",
    type: "paragraph",
    children: [{ id: "text/main", type: "text", text: "Hello" }],
  }],
};

const graph = {
  id: "graph/main",
  nodes: [{ id: "node/main", type: "value", ports: [] }],
  connections: [],
};

test("Hodos 2D UI adapts document and graph hosts through Workspace", async () => {
  const calls = [];
  const sends = {};
  const registry = createHodosComponentRegistry();
  const unregister = registerHodos2dUi(registry, {
    createDocumentHost({ container, dispatch }) {
      calls.push(["document/create", container]);
      sends.document = dispatch;
      return {
        update(model) { calls.push(["document/update", model.document.revision]); },
        dispose() { calls.push(["document/dispose"]); },
      };
    },
    createGraphHost({ container, dispatch }) {
      calls.push(["graph/create", container]);
      sends.graph = dispatch;
      return {
        update(model) { calls.push(["graph/update", model.counts.nodes]); },
        destroy() { calls.push(["graph/destroy"]); },
      };
    },
  });

  const documentEvents = [];
  const documentRoot = { dataset: {} };
  const documentHost = createWorkspaceAreaHost({
    root: documentRoot,
    registry,
    dispatch: (event) => documentEvents.push(event),
  });
  documentHost.open(createDocumentArea({ document }));
  await sends.document({ "event/type": "document/select", nodeId: "block/main" });
  documentHost.update(createDocumentArea({ document: { ...document, revision: 2 } }));
  documentHost.destroy();

  const graphEvents = [];
  const graphRoot = { dataset: {} };
  const graphHost = createWorkspaceAreaHost({
    root: graphRoot,
    registry,
    dispatch: (event) => graphEvents.push(event),
  });
  graphHost.open(createGraphArea({ graph }));
  await sends.graph({ "event/type": "graph/select", nodeIds: ["node/main"] });
  graphHost.destroy();
  unregister();

  assert.deepEqual(calls, [
    ["document/create", documentRoot],
    ["document/update", 0],
    ["document/update", 2],
    ["document/dispose"],
    ["graph/create", graphRoot],
    ["graph/update", 1],
    ["graph/destroy"],
  ]);
  assert.deepEqual(documentEvents, [{
    "event/type": "document/select",
    nodeId: "block/main",
    "component/id": "hodos.2d/document",
    "area/id": "document/main",
  }]);
  assert.deepEqual(graphEvents, [{
    "event/type": "graph/select",
    nodeIds: ["node/main"],
    "component/id": "hodos.2d/graph",
    "area/id": "graph/main",
  }]);
  assert.equal(registry.has("hodos.2d/document"), false);
  assert.equal(registry.has("hodos.2d/graph"), false);
});

test("Hodos 2D UI requires the host update contract", () => {
  const registry = createHodosComponentRegistry();
  registerHodosDocumentUi(registry, { createDocumentHost() { return {}; } });
  const host = createWorkspaceAreaHost({ root: { dataset: {} }, registry });
  assert.throws(() => host.open(createDocumentArea({ document })), /must implement update/);
});
