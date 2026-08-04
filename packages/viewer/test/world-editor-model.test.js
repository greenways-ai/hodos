import assert from "node:assert/strict";
import test from "node:test";
import {
  activeWorldItem,
  createWorldEntity,
  duplicateWorldEntity,
  editorState,
  flattenWorldHierarchy,
  normalizeWorldEntity,
  patchWorldEntity,
  worldEntityRadius,
} from "../src/world-editor-model.js";

test("creates normalized primitive and light entities", () => {
  const cube = createWorldEntity("box", { id: "cube-1", position: [1, 2, 3] });
  assert.equal(cube.name, "Cube");
  assert.deepEqual(cube.transform.position, [1, 2, 3]);
  assert.equal(cube.components.primitive.shape, "box");
  const light = createWorldEntity("point-light", { id: "light-1" });
  assert.equal(light.components.light.type, "point");
  assert.equal(light.components.light.range, 12);
});

test("patches and duplicates entities without sharing nested values", () => {
  const source = createWorldEntity("sphere", { id: "sphere-1" });
  const patched = patchWorldEntity(source, { transform: { rotation: [0, 45, 0] } });
  assert.deepEqual(patched.transform.position, [0, 0, 0]);
  assert.deepEqual(patched.transform.rotation, [0, 45, 0]);
  const duplicate = duplicateWorldEntity(patched, "sphere-2");
  duplicate.components.primitive.color = "#ffffff";
  assert.notEqual(source.components.primitive.color, duplicate.components.primitive.color);
  assert.deepEqual(duplicate.transform.position, [0.35, 0, 0.35]);
});

test("flattens parented entities and safely recovers invalid cycles", () => {
  const values = [
    normalizeWorldEntity({ id: "root", name: "Root", kind: "empty" }),
    normalizeWorldEntity({ id: "child", name: "Child", kind: "box", parent: "root" }),
    normalizeWorldEntity({ id: "orphan", name: "Orphan", kind: "sphere", parent: "missing" }),
  ];
  assert.deepEqual(
    flattenWorldHierarchy(values).map(({ entity, depth }) => [entity.id, depth]),
    [["orphan", 0], ["root", 0], ["child", 1]],
  );
});

test("normalizes editor selection and resolves active world items", () => {
  const editor = editorState({
    mode: "edit",
    tool: "translate",
    selection: [{ type: "entity", id: "cube" }],
  });
  assert.deepEqual(editor.active, { type: "entity", id: "cube" });
  const state = {
    world: {
      editor,
      draft: { entities: [createWorldEntity("box", { id: "cube" })], audioSources: [] },
    },
  };
  assert.equal(activeWorldItem(state).value.id, "cube");
  assert.ok(worldEntityRadius(activeWorldItem(state).value) > 0);
});
