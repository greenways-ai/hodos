import assert from "node:assert/strict";
import test from "node:test";
import { createCatalogArea } from "@greenways/hodos-dev";
import { createHodosComponentRegistry } from "@greenways/hodos-web";
import { createWorkspaceAreaHost } from "@greenways/hodos-workspace-ui";
import { registerHodosCatalogUi } from "../src/index.js";

test("Hodos Dev Catalog adapts injected hosts for multiple surfaces", async () => {
  const calls = [];
  let send;
  const registry = createHodosComponentRegistry();
  const unregister = registerHodosCatalogUi(registry, {
    createCatalogHost({ container, dispatch }) {
      calls.push(["create", container]);
      send = dispatch;
      return {
        update(model) {
          calls.push(["update", model.surface, model.selection.toolsetId, model.selection.activityId]);
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

  host.open(createCatalogArea({ id: "catalog/tools", surface: "tools" }));
  await send({ "event/type": "catalog/select-toolset", toolsetId: "values" });
  host.update(createCatalogArea({
    id: "catalog/tools",
    surface: "tools",
    toolsets: [{ id: "values", title: "Values", description: "Values", tools: [] }],
    selectedToolsetId: "values",
  }));
  host.destroy();
  unregister();

  assert.deepEqual(calls, [
    ["create", root],
    ["update", "tools", null, null],
    ["update", "tools", "values", null],
    ["dispose"],
  ]);
  assert.deepEqual(events, [{
    "event/type": "catalog/select-toolset",
    toolsetId: "values",
    "component/id": "hodos.dev/catalog",
    "area/id": "catalog/tools",
  }]);
  assert.equal(registry.has("hodos.dev/catalog"), false);
});

test("Hodos Dev Catalog host must implement update", () => {
  const registry = createHodosComponentRegistry();
  registerHodosCatalogUi(registry, { createCatalogHost() { return {}; } });
  const host = createWorkspaceAreaHost({ root: { dataset: {} }, registry });
  assert.throws(() => host.open(createCatalogArea()), /must implement update/);
});
