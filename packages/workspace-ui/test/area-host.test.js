import assert from "node:assert/strict";
import test from "node:test";
import { createHodosComponentRegistry } from "@greenways/hodos-web";
import { createWorkspaceAreaHost, normalizeWorkspaceArea } from "../src/index.js";

test("Workspace areas normalize HAL-shaped descriptors", () => {
  const area = normalizeWorkspaceArea({
    "area/id": "preview/main",
    "area/type": "hodos.dev/preview",
    "area/title": "Preview",
    "area/component": { "component/id": "hodos.dev/preview" },
  });
  assert.equal(area.id, "preview/main");
  assert.equal(area.component.id, "hodos.dev/preview");
});

test("area host annotates events and releases replaced components", () => {
  const calls = [];
  const events = [];
  const registry = createHodosComponentRegistry();
  registry.register("preview", ({ model, dispatch }) => {
    calls.push(["mount", model]);
    dispatch({ "event/type": "preview/retry" });
    return {
      update(next) { calls.push(["update", next]); },
      destroy() { calls.push(["destroy"]); },
    };
  });
  const root = { dataset: {} };
  const host = createWorkspaceAreaHost({
    root,
    registry,
    dispatch: (event) => events.push(event),
  });
  host.open({
    id: "preview/main",
    type: "dev/preview",
    component: { id: "preview", model: 1, events: ["preview/retry"] },
  });
  host.update({
    id: "preview/main",
    type: "dev/preview",
    component: { id: "preview", model: 2, events: ["preview/retry"] },
  });
  host.close();
  assert.equal(root.dataset.areaId, undefined);
  assert.deepEqual(calls, [["mount", 1], ["update", 2], ["destroy"]]);
  assert.deepEqual(events, [{
    "event/type": "preview/retry",
    "component/id": "preview",
    "area/id": "preview/main",
  }]);
});
