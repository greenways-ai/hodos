import assert from "node:assert/strict";
import test from "node:test";
import { createEditorArea } from "@greenways/hodos-dev";
import { createHodosComponentRegistry } from "@greenways/hodos-web";
import { createWorkspaceAreaHost } from "@greenways/hodos-workspace-ui";
import { registerHodosDevUi } from "../src/index.js";

test("Hodos Dev Editor adapts an injected editor host", async () => {
  const calls = [];
  let send;
  const registry = createHodosComponentRegistry();
  const unregister = registerHodosDevUi(registry, {
    createEditorHost({ container, dispatch }) {
      calls.push(["create", container]);
      send = dispatch;
      return {
        update(model) { calls.push(["update", model.source, model.document.version]); },
        dispose() { calls.push(["dispose"]); },
      };
    },
  });
  const root = { dataset: {} };
  const events = [];
  const host = createWorkspaceAreaHost({
    root,
    registry,
    dispatch: (event) => events.push(event),
  });
  host.open(createEditorArea({ source: "(+ 1 2)", version: 1 }));
  await send({
    "event/type": "editor/change",
    operation: { op: "replace", from: 3, to: 4, text: "2" },
  });
  host.update(createEditorArea({ source: "(+ 2 2)", version: 2 }));
  host.destroy();
  unregister();
  assert.deepEqual(calls, [
    ["create", root],
    ["update", "(+ 1 2)", 1],
    ["update", "(+ 2 2)", 2],
    ["dispose"],
  ]);
  assert.deepEqual(events, [{
    "event/type": "editor/change",
    operation: { op: "replace", from: 3, to: 4, text: "2" },
    "component/id": "hodos.dev/editor",
    "area/id": "editor/main",
  }]);
  assert.equal(registry.has("hodos.dev/editor"), false);
  assert.equal(registry.has("hodos.dev/preview"), false);
});

test("Hodos Dev Editor requires a host update contract", () => {
  const registry = createHodosComponentRegistry();
  registerHodosDevUi(registry, {
    createEditorHost() { return {}; },
  });
  const host = createWorkspaceAreaHost({ root: { dataset: {} }, registry });
  assert.throws(() => host.open(createEditorArea()), /must implement update/);
});
