import assert from "node:assert/strict";
import test from "node:test";
import {
  createHodosComponentHost,
  createHodosComponentRegistry,
} from "../../web/src/index.js";
import {
  HODOS_RIGGING_AUTHORING_COMPONENT_ID,
  HODOS_RIGGING_AUTHORING_EVENTS,
  registerHodosRiggingAuthoringUi,
} from "../src/index.js";

test("Rigging Authoring registers one injected workspace component host", async () => {
  const registry = createHodosComponentRegistry();
  const updates = [];
  const dispatched = [];
  let destroyed = false;
  let componentDispatch = null;

  registerHodosRiggingAuthoringUi(registry, {
    createRiggingAuthoringHost({ root, model, dispatch }) {
      assert.equal(root.id, "rigging-root");
      assert.equal(model.rigging.authoring.document.revision, 2);
      componentDispatch = dispatch;
      return {
        update(state) {
          updates.push(state.rigging.authoring.document.revision);
        },
        destroy() {
          destroyed = true;
        },
      };
    },
  });

  assert.equal(registry.has(HODOS_RIGGING_AUTHORING_COMPONENT_ID), true);
  const host = createHodosComponentHost({
    root: { id: "rigging-root" },
    registry,
    dispatch(event) {
      dispatched.push(event);
    },
  });
  const model = (revision) => ({
    "component/id": HODOS_RIGGING_AUTHORING_COMPONENT_ID,
    "component/contract": "workspace.component/0-alpha",
    "component/model": {
      state: {
        rigging: {
          authoring: {
            document: { revision },
          },
        },
      },
    },
    "component/events": HODOS_RIGGING_AUTHORING_EVENTS,
  });

  host.mount(model(2));
  assert.deepEqual(updates, [2]);
  host.update(model(3));
  assert.deepEqual(updates, [2, 3]);

  await componentDispatch({ "event/type": "rig/editor-select", jointIds: ["root"] });
  assert.equal(dispatched[0]["component/id"], HODOS_RIGGING_AUTHORING_COMPONENT_ID);
  assert.equal(dispatched[0]["event/type"], "rig/editor-select");
  await assert.rejects(
    () => componentDispatch({ "event/type": "rig/undeclared" }),
    /cannot dispatch undeclared event/,
  );

  host.destroy();
  assert.equal(destroyed, true);
});

test("Rigging Authoring fails closed without an injected browser host", () => {
  const registry = createHodosComponentRegistry();
  registerHodosRiggingAuthoringUi(registry);
  const host = createHodosComponentHost({ root: {}, registry });
  assert.throws(() => host.mount({
    "component/id": HODOS_RIGGING_AUTHORING_COMPONENT_ID,
    "component/model": { state: {} },
    "component/events": HODOS_RIGGING_AUTHORING_EVENTS,
  }), /createRiggingAuthoringHost/);
});
