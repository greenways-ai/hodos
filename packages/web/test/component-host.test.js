import assert from "node:assert/strict";
import test from "node:test";
import {
  HODOS_COMPONENT_CONTRACT,
  createHodosComponentHost,
  createHodosComponentRegistry,
  normalizeComponentDescriptor,
} from "../src/index.js";

test("component descriptors accept HAL-shaped keys", () => {
  assert.deepEqual(normalizeComponentDescriptor({
    "component/id": "hodos.dev/preview",
    "component/contract": HODOS_COMPONENT_CONTRACT,
    "component/model": { ready: true },
    "component/events": ["preview/retry", "preview/retry"],
  }), {
    id: "hodos.dev/preview",
    contract: HODOS_COMPONENT_CONTRACT,
    model: { ready: true },
    events: ["preview/retry"],
  });
});

test("component hosts mount, update, dispatch and dispose", async () => {
  const calls = [];
  const registry = createHodosComponentRegistry();
  registry.register("example/component", ({ model, dispatch }) => {
    calls.push(["mount", model]);
    dispatch({ "event/type": "example/change", value: 1 });
    return {
      update(next) { calls.push(["update", next]); },
      destroy() { calls.push(["destroy"]); },
    };
  });
  const events = [];
  const host = createHodosComponentHost({
    root: {},
    registry,
    dispatch: (event) => events.push(event),
  });
  host.mount({
    id: "example/component",
    model: { value: 1 },
    events: ["example/change"],
  });
  host.update({
    id: "example/component",
    model: { value: 2 },
    events: ["example/change"],
  });
  host.destroy();
  assert.deepEqual(calls, [
    ["mount", { value: 1 }],
    ["update", { value: 2 }],
    ["destroy"],
  ]);
  assert.deepEqual(events, [{
    "event/type": "example/change",
    value: 1,
    "component/id": "example/component",
  }]);
  assert.throws(() => host.mount({ id: "example/component" }), /destroyed/);
});

test("component hosts reject undeclared semantic events", async () => {
  let rejected;
  const registry = createHodosComponentRegistry();
  registry.register("example/component", ({ dispatch }) => {
    rejected = dispatch({ "event/type": "example/hidden" });
  });
  createHodosComponentHost({ root: {}, registry }).mount({
    id: "example/component",
    events: ["example/allowed"],
  });
  await assert.rejects(rejected, /undeclared event/);
});
