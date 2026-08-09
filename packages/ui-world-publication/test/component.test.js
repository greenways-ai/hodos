import assert from "node:assert/strict";
import test from "node:test";
import {
  createHodosComponentHost,
  createHodosComponentRegistry,
} from "../../web/src/index.js";
import {
  HODOS_WORLD_PUBLICATION_COMPONENT_ID,
  HODOS_WORLD_PUBLICATION_EVENTS,
  registerHodosWorldPublicationUi,
} from "../src/index.js";

test("World Publication registers one injected review component host", async () => {
  const registry = createHodosComponentRegistry();
  const updates = [];
  const dispatched = [];
  let disposed = false;
  let componentDispatch = null;

  registerHodosWorldPublicationUi(registry, {
    createWorldPublicationHost({ root, model, dispatch }) {
      assert.equal(root.id, "publication-root");
      assert.equal(model.world.review.proposal.id, "proposal-1");
      componentDispatch = dispatch;
      return {
        update(state) {
          updates.push(state.world.review.selected.length);
        },
        dispose() {
          disposed = true;
        },
      };
    },
  });

  const host = createHodosComponentHost({
    root: { id: "publication-root" },
    registry,
    dispatch(event) {
      dispatched.push(event);
    },
  });
  host.mount({
    "component/id": HODOS_WORLD_PUBLICATION_COMPONENT_ID,
    "component/contract": "workspace.component/1",
    "component/model": {
      state: {
        world: {
          review: {
            proposal: { id: "proposal-1" },
            selected: ["entity:cube-a", "source:source-a"],
          },
        },
      },
    },
    "component/events": HODOS_WORLD_PUBLICATION_EVENTS,
  });
  assert.deepEqual(updates, [2]);

  await componentDispatch({
    "event/type": "world/draft-review-toggle",
    change: "source:source-a",
  });
  assert.equal(dispatched[0]["component/id"], HODOS_WORLD_PUBLICATION_COMPONENT_ID);
  assert.equal(dispatched[0].change, "source:source-a");

  host.destroy();
  assert.equal(disposed, true);
});

test("World Publication fails closed without an injected browser host", () => {
  const registry = createHodosComponentRegistry();
  registerHodosWorldPublicationUi(registry);
  const host = createHodosComponentHost({ root: {}, registry });
  assert.throws(() => host.mount({
    "component/id": HODOS_WORLD_PUBLICATION_COMPONENT_ID,
    "component/model": { state: {} },
    "component/events": HODOS_WORLD_PUBLICATION_EVENTS,
  }), /createWorldPublicationHost/);
});
