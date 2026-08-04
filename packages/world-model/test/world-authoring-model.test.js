import assert from "node:assert/strict";
import test from "node:test";
import {
  applySelectionMode,
  attachScript,
  capturePrefab,
  createCollection,
  evaluateAnimation,
  instantiatePrefab,
  moveSelectionToCollection,
  projectedTargetsInRect,
  selectionPivot,
  setAnimationKeyframe,
  transformSelectionItems,
} from "../src/world-authoring-model.js";
import { createWorldEntity } from "../src/world-editor-model.js";

const cube = createWorldEntity("box", { id: "cube", position: [0, 0, 0] });
const sphere = createWorldEntity("sphere", { id: "sphere", position: [2, 0, 0] });
const document = {
  entities: [cube, sphere],
  audioSources: [{ id: "audio", position: [1, 0, 1] }],
  collections: [],
  assets: [],
  prefabs: [],
  animations: [{ id: "main", name: "Main", duration: 4, fps: 30, tracks: [] }],
};

test("selection modes and box projection support desktop multi-selection", () => {
  const cubeTarget = { type: "entity", id: "cube" };
  const sphereTarget = { type: "entity", id: "sphere" };
  assert.deepEqual(applySelectionMode([], [cubeTarget], "replace"), [cubeTarget]);
  assert.deepEqual(applySelectionMode([cubeTarget], [sphereTarget], "add"), [cubeTarget, sphereTarget]);
  assert.deepEqual(applySelectionMode([cubeTarget, sphereTarget], [cubeTarget], "toggle"), [sphereTarget]);
  assert.deepEqual(projectedTargetsInRect([
    { ...cubeTarget, x: 20, y: 20, visible: true },
    { ...sphereTarget, x: 120, y: 20, visible: true },
    { type: "audio", id: "audio", x: 30, y: 30, visible: false },
  ], { left: 0, top: 0, right: 80, bottom: 80 }), [cubeTarget]);
});

test("pivots, snapping and multi-object transforms are deterministic", () => {
  const editor = {
    selection: [{ type: "entity", id: "cube" }, { type: "entity", id: "sphere" }],
    active: { type: "entity", id: "sphere" },
    pivot: "median",
    snap: { enabled: true, translate: 0.5, rotate: 15, scale: 0.25 },
  };
  assert.deepEqual(selectionPivot(document, editor), [1, 0, 0]);
  const moved = transformSelectionItems(document, editor, {
    tool: "translate",
    axes: [0, 2],
    amount: 0.6,
  });
  assert.deepEqual(moved.map((item) => item.transform.position), [[0.5, 0, 0.5], [2.5, 0, 0.5]]);
  const rotated = transformSelectionItems(document, editor, {
    tool: "rotate",
    axes: [1],
    amount: 44,
  });
  assert.deepEqual(rotated.map((item) => item.transform.rotation[1]), [45, 45]);
  assert.notDeepEqual(rotated[0].transform.position, cube.transform.position);
});

test("collections organize selections and support isolation-ready membership", () => {
  const withCollection = createCollection(document, { id: "set", name: "Set Dressing" });
  const moved = moveSelectionToCollection(withCollection, {
    selection: [{ type: "entity", id: "cube" }],
  }, "set");
  assert.equal(moved.entities.find((entity) => entity.id === "cube").collection, "set");
  assert.equal(moved.entities.find((entity) => entity.id === "sphere").collection, null);
});

test("selected hierarchies round-trip through prefab capture and instantiation", () => {
  const parent = { ...cube, id: "parent", name: "Parent" };
  const child = { ...sphere, id: "child", name: "Child", parent: "parent" };
  const source = { ...document, entities: [parent, child] };
  const prefab = capturePrefab(source, {
    selection: [{ type: "entity", id: "parent" }, { type: "entity", id: "child" }],
  }, { id: "prefab-room", name: "Room Pair" });
  assert.deepEqual(prefab.rootIds, ["parent"]);
  const instances = instantiatePrefab(prefab, {
    idFor: (id) => `instance-${id}`,
    position: [10, 0, 0],
    collection: "set",
  });
  assert.equal(instances.find((entity) => entity.id === "instance-child").parent, "instance-parent");
  assert.deepEqual(instances.find((entity) => entity.id === "instance-parent").transform.position, [10, 0, 0]);
  assert.equal(instances[0].collection, "set");
});

test("animation keyframes interpolate transforms on the browser timeline", () => {
  let animation = document.animations[0];
  animation = setAnimationKeyframe(animation, {
    id: "start",
    entity: "cube",
    property: "position",
    time: 0,
    value: [0, 0, 0],
  });
  animation = setAnimationKeyframe(animation, {
    id: "end",
    entity: "cube",
    property: "position",
    time: 4,
    value: [8, 0, 0],
  });
  assert.deepEqual(evaluateAnimation(animation, 2), [{
    entity: "cube",
    property: "position",
    value: [4, 0, 0],
  }]);
});

test("Hara scripts attach as portable components rather than host objects", () => {
  const scripted = attachScript(cube, {
    source: '(fn [event entity world] {"entity" entity})',
    events: ["world/start", "world/entity-transform", "world/start"],
  });
  assert.equal(scripted.components.script.language, "hara");
  assert.deepEqual(scripted.components.script.events, ["world/start", "world/entity-transform"]);
  assert.match(scripted.components.script.source, /^\(fn/);
});
