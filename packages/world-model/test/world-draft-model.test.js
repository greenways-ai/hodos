import assert from "node:assert/strict";
import test from "node:test";
import { nudgePosition, sourcePosition } from "../src/world-draft-model.js";

test("world draft positions are copied and normalized", () => {
  const original = [1, 2, 3];
  const value = sourcePosition({ position: original });
  assert.deepEqual(value, original);
  assert.notEqual(value, original);
  assert.deepEqual(sourcePosition({ position: [1, Number.NaN, 3] }), [0, 0, 0]);
});

test("world draft gizmo nudges one axis at a time", () => {
  assert.deepEqual(nudgePosition([1, 2, 3], 0, 0.25), [1.25, 2, 3]);
  assert.deepEqual(nudgePosition([1, 2, 3], 1, -0.5), [1, 1.5, 3]);
  assert.deepEqual(nudgePosition([1, 2, 3], 2, 1), [1, 2, 4]);
  assert.throws(() => nudgePosition([0, 0, 0], 4, 1), /axis/);
});
