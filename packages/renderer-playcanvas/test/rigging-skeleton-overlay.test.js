import assert from "node:assert/strict";
import test from "node:test";
import { createRigDocument } from "@greenways/hodos-world-model/rigging";
import {
  pickProjectedRigJoint,
  rigSkeletonProjection,
} from "../src/rigging-skeleton-overlay.js";
import {
  intersectRayBounds,
  intersectRayPlane,
  rigPlacementPoint,
} from "../src/rigging-authoring-renderer.js";

function rig() {
  return createRigDocument({
    id: "rig:creature",
    assetId: "sha256:creature",
    joints: [
      { id: "root", parent: null, rest: { translation: [0, 0, 0] } },
      { id: "wing", parent: "root", rest: { translation: [1, 0, 0] } },
      { id: "tip", parent: "wing", rest: { translation: [1, 0, 0] } },
    ],
  });
}

test("skeleton projection contains no PlayCanvas entities", () => {
  const projection = rigSkeletonProjection(rig(), {
    selection: ["wing"],
    active: "wing",
    expanded: ["root", "wing"],
  });
  assert.deepEqual(projection.joints.map(({ id, position }) => [id, position]), [
    ["root", [0, 0, 0]],
    ["wing", [1, 0, 0]],
    ["tip", [2, 0, 0]],
  ]);
  assert.deepEqual(projection.bones.map(({ id, selected }) => [id, selected]), [
    ["root->wing", true],
    ["wing->tip", true],
  ]);
  assert.equal(JSON.stringify(projection).includes("Entity"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(projection)), projection);
});

test("host-local previews update descendants without advancing revision", () => {
  const document = rig();
  const projection = rigSkeletonProjection(document, { active: "wing", selection: ["wing"] }, {
    jointId: "wing",
    worldPosition: [0, 1, 0],
  });
  assert.equal(projection.document.revision, document.revision);
  assert.deepEqual(projection.joints.find(({ id }) => id === "wing").position, [0, 1, 0]);
  assert.deepEqual(projection.joints.find(({ id }) => id === "tip").position, [1, 1, 0]);
  assert.deepEqual(document.joints.find(({ id }) => id === "wing").rest.translation, [1, 0, 0]);
});

test("screen-space picking prefers the nearest visible joint", () => {
  const picked = pickProjectedRigJoint([
    { id: "behind", x: 100, y: 100, depth: 10, visible: true },
    { id: "front", x: 100, y: 100, depth: 2, visible: true },
    { id: "hidden", x: 99, y: 99, depth: 1, visible: false },
  ], 102, 101, 20);
  assert.equal(picked.id, "front");
  assert.equal(pickProjectedRigJoint([{ id: "far", x: 200, y: 200, depth: 1, visible: true }], 0, 0, 20), null);
});

test("ray-plane intersection rejects parallel and rearward intersections", () => {
  assert.deepEqual(intersectRayPlane(
    { origin: [0, 0, 5], direction: [0, 0, -1] },
    [0, 0, 0],
    [0, 0, 1],
  ), [0, 0, 0]);
  assert.equal(intersectRayPlane(
    { origin: [0, 0, 5], direction: [1, 0, 0] },
    [0, 0, 0],
    [0, 0, 1],
  ), null);
  assert.equal(intersectRayPlane(
    { origin: [0, 0, -5], direction: [0, 0, -1] },
    [0, 0, 0],
    [0, 0, 1],
  ), null);
});

test("ray-bounds intersection supports surface placement from outside and inside", () => {
  const bounds = { min: [-1, -1, -1], max: [1, 1, 1] };
  assert.deepEqual(intersectRayBounds({ origin: [0, 0, 5], direction: [0, 0, -1] }, bounds), [0, 0, 1]);
  assert.deepEqual(intersectRayBounds({ origin: [0, 0, 0], direction: [1, 0, 0] }, bounds), [1, 0, 0]);
  assert.equal(intersectRayBounds({ origin: [5, 5, 5], direction: [1, 0, 0] }, bounds), null);
});

test("placement modes choose supplied surfaces, bounds, grid and depth deterministically", () => {
  const ray = { origin: [0, 2, 5], direction: [0, -0.2, -1] };
  assert.deepEqual(rigPlacementPoint({
    ray,
    mode: "surface",
    surfacePoint: [0.5, 0.5, 0.5],
  }), [0.5, 0.5, 0.5]);
  const bounded = rigPlacementPoint({
    ray: { origin: [0, 0, 5], direction: [0, 0, -1] },
    mode: "surface",
    bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
  });
  assert.deepEqual(bounded, [0, 0, 1]);
  const grid = rigPlacementPoint({
    ray,
    mode: "grid",
    gridY: 0,
    anchor: [0, 0, 0],
    cameraForward: [0, 0, -1],
  });
  assert.ok(Math.abs(grid[1]) < 1e-7);
  const depth = rigPlacementPoint({
    ray: { origin: [0, 0, 5], direction: [0, 0, -1] },
    mode: "depth",
    anchor: [0, 0, 2],
    cameraForward: [0, 0, 1],
  });
  assert.deepEqual(depth, [0, 0, 2]);
});
