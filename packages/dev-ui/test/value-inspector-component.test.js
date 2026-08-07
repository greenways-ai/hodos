import assert from "node:assert/strict";
import test from "node:test";
import { createValueInspectorArea } from "@greenways/hodos-dev";
import { createHodosComponentRegistry } from "@greenways/hodos-web";
import { createWorkspaceAreaHost } from "@greenways/hodos-workspace-ui";
import { registerHodosValueInspectorUi } from "../src/index.js";

test("Hodos Dev Value Inspector adapts an injected host and routes semantic events", async () => {
  const calls = [];
  let send;
  const registry = createHodosComponentRegistry();
  const unregister = registerHodosValueInspectorUi(registry, {
    createValueInspectorHost({ container, dispatch }) {
      calls.push(["create", container]);
      send = dispatch;
      return {
        update(model) {
          calls.push(["update", model.status, model.value.id, model.value.display]);
        },
        dispose() {
          calls.push(["dispose"]);
        },
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

  host.open(createValueInspectorArea({
    valueId: "value-1",
    status: "loading",
    display: "Loading…",
  }));
  await send({ "event/type": "value/toggle", path: ["answer"] });
  host.update(createValueInspectorArea({
    valueId: "value-1",
    status: "ready",
    display: "{:answer 42}",
    value: { answer: 42 },
  }));
  host.destroy();
  unregister();

  assert.deepEqual(calls, [
    ["create", root],
    ["update", "loading", "value-1", "Loading…"],
    ["update", "ready", "value-1", "{:answer 42}"],
    ["dispose"],
  ]);
  assert.deepEqual(events, [{
    "event/type": "value/toggle",
    path: ["answer"],
    "component/id": "hodos.dev/value-inspector",
    "area/id": "value/main",
  }]);
  assert.equal(registry.has("hodos.dev/value-inspector"), false);
});

test("Hodos Dev Value Inspector host must implement update", () => {
  const registry = createHodosComponentRegistry();
  registerHodosValueInspectorUi(registry, {
    createValueInspectorHost() {
      return {};
    },
  });
  const host = createWorkspaceAreaHost({ root: { dataset: {} }, registry });
  assert.throws(() => host.open(createValueInspectorArea()), /must implement update/);
});
