import assert from "node:assert/strict";
import test from "node:test";
import {
  HARA_BYTECODE_METRICS_SCHEMA,
  createExecutionArea,
  createExecutionState,
} from "@greenways/hodos-dev";
import { createHodosComponentRegistry } from "@greenways/hodos-web";
import { createWorkspaceAreaHost } from "@greenways/hodos-workspace-ui";
import { registerHodosDevUi } from "../src/index.js";

test("Hodos Dev Execution adapts an injected renderer-neutral host", async () => {
  const calls = [];
  const events = [];
  let send;
  const registry = createHodosComponentRegistry();
  const unregister = registerHodosDevUi(registry, {
    createExecutionHost({ container, dispatch }) {
      calls.push(["create", container]);
      send = dispatch;
      return {
        update(model) {
          calls.push([
            "update",
            model.session.status,
            model.evidence.metrics?.instructions ?? null,
          ]);
        },
        dispose() { calls.push(["dispose"]); },
      };
    },
  });

  const root = { dataset: {} };
  const host = createWorkspaceAreaHost({
    root,
    registry,
    dispatch: (event) => events.push(event),
  });
  host.open(createExecutionArea({
    state: createExecutionState({ sessionId: "execution/lesson" }),
  }));
  await send({ "event/type": "execution/request-trace", function: 0, ip: 2 });
  host.update(createExecutionArea({
    state: createExecutionState({
      sessionId: "execution/lesson",
      status: "running",
      metrics: {
        schema: HARA_BYTECODE_METRICS_SCHEMA,
        instructions: 5,
        opcodeCounts: { constant: 2, return: 1 },
      },
    }),
  }));
  host.destroy();
  unregister();

  assert.deepEqual(calls, [
    ["create", root],
    ["update", "connected", null],
    ["update", "running", 5],
    ["dispose"],
  ]);
  assert.deepEqual(events, [{
    "event/type": "execution/request-trace",
    function: 0,
    ip: 2,
    "component/id": "hodos.dev/execution",
    "area/id": "execution/main",
  }]);
  assert.equal(registry.has("hodos.dev/execution"), false);
});

test("Hodos Dev Execution requires the injected host update contract", () => {
  const registry = createHodosComponentRegistry();
  registerHodosDevUi(registry, {
    createExecutionHost() { return {}; },
  });
  const host = createWorkspaceAreaHost({ root: { dataset: {} }, registry });
  assert.throws(() => host.open(createExecutionArea()), /must implement update/);
});
