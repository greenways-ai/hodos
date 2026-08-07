import assert from "node:assert/strict";
import test from "node:test";
import {
  HODOS_DEV_VALUE_INSPECTOR_AREA_TYPE,
  HODOS_DEV_VALUE_INSPECTOR_COMPONENT_ID,
  createValueInspectorArea,
} from "../src/index.js";

test("Value Inspector area is a serializable HAL-shaped Workspace value", () => {
  const area = createValueInspectorArea({
    valueId: "value-7",
    requestId: "request-4",
    status: "ready",
    display: "{:answer 42}",
    valueType: "map",
    value: { answer: 42, nested: ["a", true, null] },
    namespace: "app.core",
    source: "(answer)",
    path: ["nested", 0],
    expanded: [[], ["nested"]],
    metadata: { origin: "repl", retained: true },
  });
  const component = area["area/component"];
  const model = component["component/model"];

  assert.equal(area["area/type"], HODOS_DEV_VALUE_INSPECTOR_AREA_TYPE);
  assert.equal(component["component/id"], HODOS_DEV_VALUE_INSPECTOR_COMPONENT_ID);
  assert.equal(component["component/contract"], "workspace.component/1");
  assert.equal(model.value.id, "value-7");
  assert.equal(model.value.type, "map");
  assert.deepEqual(model.value.data, { answer: 42, nested: ["a", true, null] });
  assert.deepEqual(model.path, ["nested", 0]);
  assert.deepEqual(model.expanded, [[], ["nested"]]);
  assert.equal(JSON.parse(JSON.stringify(area))["area/id"], "value/main");
});

test("Value Inspector validates status, paths and serializable data", () => {
  assert.throws(() => createValueInspectorArea({ status: "evaluating" }), /Unsupported.*status/);
  assert.throws(() => createValueInspectorArea({ display: null }), /display must be a string/);
  assert.throws(() => createValueInspectorArea({ path: ["answer", -1] }), /segment 1/);
  assert.throws(() => createValueInspectorArea({ expanded: [null] }), /expanded path 0 must be an array/);
  assert.throws(() => createValueInspectorArea({ metadata: [] }), /metadata must be an object/);
  assert.throws(() => createValueInspectorArea({ value: { answer: 1n } }), /serializable values/);

  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => createValueInspectorArea({ value: cyclic }), /must not contain cycles/);
});
