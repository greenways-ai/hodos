import assert from "node:assert/strict";
import test from "node:test";
import {
  createHodosComponentHost,
  createHodosComponentRegistry,
} from "../../web/src/index.js";
import {
  HODOS_WORLD_AUTHORING_COMPONENT_ID,
  HODOS_WORLD_AUTHORING_EVENTS,
  registerHodosWorldAuthoringUi,
} from "../src/index.js";

test("World Authoring registers one injected Workspace component host", async () => {
  const registry = createHodosComponentRegistry();
  const updates = [];
  const dispatched = [];
  let destroyed = false;
  let componentDispatch = null;

  registerHodosWorldAuthoringUi(registry, {
    createWorldAuthoringHost({ root, model, dispatch }) {
      assert.equal(root.id, "authoring-root");
      assert.equal(model.world.draft.revision, 3);
      componentDispatch = dispatch;
      return {
        update(state) {
          updates.push(state.world.draft.revision);
        },
        destroy() {
          destroyed = true;
        },
      };
    },
  });

  assert.equal(registry.has(HODOS_WORLD_AUTHORING_COMPONENT_ID), true);
  const host = createHodosComponentHost({
    root: { id: "authoring-root" },
    registry,
    dispatch(event) {
      dispatched.push(event);
    },
  });
  host.mount({
    "component/id": HODOS_WORLD_AUTHORING_COMPONENT_ID,
    "component/contract": "workspace.component/1",
    "component/model": { state: { world: { draft: { revision: 3 } } } },
    "component/events": HODOS_WORLD_AUTHORING_EVENTS,
  });
  assert.deepEqual(updates, [3]);

  host.update({
    "component/id": HODOS_WORLD_AUTHORING_COMPONENT_ID,
    "component/contract": "workspace.component/1",
    "component/model": { state: { world: { draft: { revision: 4 } } } },
    "component/events": HODOS_WORLD_AUTHORING_EVENTS,
  });
  assert.deepEqual(updates, [3, 4]);

  await componentDispatch({ "event/type": "world/editor-select", target: null });
  assert.equal(dispatched[0]["component/id"], HODOS_WORLD_AUTHORING_COMPONENT_ID);
  assert.equal(dispatched[0]["event/type"], "world/editor-select");
  await assert.rejects(
    () => componentDispatch({ "event/type": "world/undeclared" }),
    /cannot dispatch undeclared event/,
  );

  host.destroy();
  assert.equal(destroyed, true);
});

test("World Authoring fails closed without an injected browser host", () => {
  const registry = createHodosComponentRegistry();
  registerHodosWorldAuthoringUi(registry);
  const host = createHodosComponentHost({ root: {}, registry });
  assert.throws(() => host.mount({
    "component/id": HODOS_WORLD_AUTHORING_COMPONENT_ID,
    "component/model": { state: {} },
    "component/events": HODOS_WORLD_AUTHORING_EVENTS,
  }), /createWorldAuthoringHost/);
});
