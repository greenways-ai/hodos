import assert from "node:assert/strict";
import test from "node:test";
import {
  duplicateClip,
  splitClip,
  trimClipEnd,
  trimClipStart,
} from "../src/studio-clip-model.js";

const clip = {
  id: "clip-1",
  asset: "asset-1",
  startSeconds: 4,
  sourceStartSeconds: 2,
  duration: 6,
};

test("start trim preserves the same source moment at the new project edge", () => {
  assert.deepEqual(trimClipStart(clip, 1.12), {
    ...clip,
    startSeconds: 5,
    sourceStartSeconds: 3,
    duration: 5,
  });
  assert.deepEqual(trimClipStart(clip, -9), {
    ...clip,
    startSeconds: 2,
    sourceStartSeconds: 0,
    duration: 8,
  });
});

test("end trim snaps and never exceeds available source audio", () => {
  assert.deepEqual(trimClipEnd(clip, 3.12, 10.1), {
    ...clip,
    duration: 8.1,
  });
  assert.equal(trimClipEnd(clip, -99, 10).duration, 0.25);
});

test("split creates adjacent source and project ranges", () => {
  const result = splitClip(clip, { offsetSeconds: 3.12, rightId: "clip-2" });
  assert.deepEqual(result.left, { ...clip, duration: 3 });
  assert.deepEqual(result.right, {
    ...clip,
    id: "clip-2",
    startSeconds: 7,
    sourceStartSeconds: 5,
    duration: 3,
  });
  assert.throws(() => splitClip({ ...clip, duration: 0.25 }), /at least 0.5 seconds/);
});

test("duplicate preserves source range and places a new clip after the original", () => {
  assert.deepEqual(duplicateClip(clip, { id: "clip-copy", gapSeconds: 0.5 }), {
    ...clip,
    id: "clip-copy",
    startSeconds: 10.5,
  });
});
