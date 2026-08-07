import assert from "node:assert/strict";
import test from "node:test";
import { createExplorerArea } from "@greenways/hodos-dev";
import { createHodosComponentRegistry } from "@greenways/hodos-web";
import { createWorkspaceAreaHost } from "@greenways/hodos-workspace-ui";
import { registerHodosExplorerUi } from "../src/index.js";

test("Hodos Dev Explorer adapts an injected host and routes semantic events", async () => {
  const calls = [];
  let send;
  const registry = createHodosComponentRegistry();
  const unregister = registerHodosExplorerUi(registry, {
    createExplorerHost({ container, dispatch }) {
      calls.push(["create", container]);
      send = dispatch;
      return {
        update(model) {
          calls.push(["update", model.entries.length, model.selection.path]);
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

  host.open(createExplorerArea({
    entries: [{ path: "src/main.hal", kind: "file" }],
  }));
  await send({ "event/type": "explorer/select", path: "src/main.hal" });
  host.update(createExplorerArea({
    entries: [{ path: "src/main.hal", kind: "file" }],
    selectedPath: "src/main.hal",
  }));
  host.destroy();
  unregister();

  assert.deepEqual(calls, [
    ["create", root],
    ["update", 1, null],
    ["update", 1, "src/main.hal"],
    ["dispose"],
  ]);
  assert.deepEqual(events, [{
    "event/type": "explorer/select",
    path: "src/main.hal",
    "component/id": "hodos.dev/explorer",
    "area/id": "explorer/main",
  }]);
  assert.equal(registry.has("hodos.dev/explorer"), false);
});

test("Hodos Dev Explorer host must implement update", () => {
  const registry = createHodosComponentRegistry();
  registerHodosExplorerUi(registry, { createExplorerHost() { return {}; } });
  const host = createWorkspaceAreaHost({ root: { dataset: {} }, registry });
  assert.throws(() => host.open(createExplorerArea()), /must implement update/);
});
