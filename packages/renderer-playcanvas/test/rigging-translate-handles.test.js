import assert from "node:assert/strict";
import test from "node:test";
import {
  RIG_TRANSLATE_AXES,
  rigScreenAxisAmount,
} from "../src/rigging-translate-handles.js";

test("screen-axis drag converts projected pointer distance into bounded world movement", () => {
  assert.equal(rigScreenAxisAmount({
    startX: 10,
    startY: 20,
    clientX: 60,
    clientY: 20,
    screenDirection: [1, 0],
    screenLength: 100,
    worldLength: 2,
  }), 1);
  assert.equal(rigScreenAxisAmount({
    startX: 10,
    startY: 20,
    clientX: 10,
    clientY: 70,
    screenDirection: [0, -1],
    screenLength: 100,
    worldLength: 2,
  }), -1);
});

test("translate handle axes remain renderer-local unit vectors", () => {
  assert.deepEqual(RIG_TRANSLATE_AXES, {
    x: [1, 0, 0],
    y: [0, 1, 0],
    z: [0, 0, 1],
  });
});
