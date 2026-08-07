import assert from "node:assert/strict";
import test from "node:test";
import { createProblemsArea } from "@greenways/hodos-dev";
import { createHodosComponentRegistry } from "@greenways/hodos-web";
import { createWorkspaceAreaHost } from "@greenways/hodos-workspace-ui";
import { registerHodosProblemsUi } from "../src/index.js";

test("Hodos Dev Problems adapts an injected host and routes semantic events", async () => {
  const calls = [];
  let send;
  const registry = createHodosComponentRegistry();
  const unregister = registerHodosProblemsUi(registry, {
    createProblemsHost({ container, dispatch }) {
      calls.push(["create", container]);
      send = dispatch;
      return {
        update(model) {
          calls.push(["update", model.status, model.counts.total, model.selection.id]);
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

  host.open(createProblemsArea({ status: "collecting" }));
  await send({ "event/type": "problems/filter", severity: "warning", query: "runtime" });
  host.update(createProblemsArea({
    status: "ready",
    problems: [{ id: "problem/1", severity: "warning", message: "Runtime fallback" }],
    selectedId: "problem/1",
  }));
  host.destroy();
  unregister();

  assert.deepEqual(calls, [
    ["create", root],
    ["update", "collecting", 0, null],
    ["update", "ready", 1, "problem/1"],
    ["dispose"],
  ]);
  assert.deepEqual(events, [{
    "event/type": "problems/filter",
    severity: "warning",
    query: "runtime",
    "component/id": "hodos.dev/problems",
    "area/id": "problems/main",
  }]);
  assert.equal(registry.has("hodos.dev/problems"), false);
});

test("Hodos Dev Problems host must implement update", () => {
  const registry = createHodosComponentRegistry();
  registerHodosProblemsUi(registry, { createProblemsHost() { return {}; } });
  const host = createWorkspaceAreaHost({ root: { dataset: {} }, registry });
  assert.throws(() => host.open(createProblemsArea()), /must implement update/);
});
