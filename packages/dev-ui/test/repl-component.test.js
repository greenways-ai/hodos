import assert from "node:assert/strict";
import test from "node:test";
import { createReplArea } from "@greenways/hodos-dev";
import { createHodosComponentRegistry } from "@greenways/hodos-web";
import { createWorkspaceAreaHost } from "@greenways/hodos-workspace-ui";
import { registerHodosReplUi } from "../src/index.js";

test("Hodos Dev REPL adapts an injected host and routes semantic events", async () => {
  const calls = [];
  let send;
  const registry = createHodosComponentRegistry();
  const unregister = registerHodosReplUi(registry, {
    createReplHost({ container, dispatch }) {
      calls.push(["create", container]);
      send = dispatch;
      return {
        update(model) { calls.push(["update", model.namespace, model.entries.length, model.canSubmit]); },
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
  host.open(createReplArea({ namespace: "user", status: "ready", entries: [] }));
  await send({ "event/type": "repl/submit", source: "(+ 1 2)" });
  host.update(createReplArea({
    namespace: "user",
    status: "ready",
    entries: [{ kind: "result", text: "3" }],
  }));
  host.destroy();
  unregister();
  assert.deepEqual(calls, [
    ["create", root],
    ["update", "user", 0, true],
    ["update", "user", 1, true],
    ["dispose"],
  ]);
  assert.deepEqual(events, [{
    "event/type": "repl/submit",
    source: "(+ 1 2)",
    "component/id": "hodos.dev/repl",
    "area/id": "repl/main",
  }]);
  assert.equal(registry.has("hodos.dev/repl"), false);
});

test("Hodos Dev REPL host must implement update", () => {
  const registry = createHodosComponentRegistry();
  registerHodosReplUi(registry, { createReplHost() { return {}; } });
  const host = createWorkspaceAreaHost({ root: { dataset: {} }, registry });
  assert.throws(() => host.open(createReplArea()), /must implement update/);
});
