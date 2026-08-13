import assert from "node:assert/strict";
import test from "node:test";
import {
  createMixamoAnimationDemoState,
  reduceMixamoAnimationDemoState,
  MIXAMO_ANIMATION_DEMO_EXPERIENCE,
  MIXAMO_ANIMATION_MAX_POSE_KEYS,
  MIXAMO_ANIMATION_MAX_SEQUENCE,
} from "../src/mixamo-animation-demo-model.js";

test("defines a dedicated animation experience and normalizes clips", () => {
  const state = createMixamoAnimationDemoState({
    clips: [
      { id: "wave", duration: 1.2, source: "built-in" },
      { id: "idle", duration: 2, loop: true, source: "built-in" },
    ],
  });
  assert.equal(MIXAMO_ANIMATION_DEMO_EXPERIENCE, "animation");
  assert.deepEqual(state.clips.map((clip) => clip.id), ["idle", "wave"]);
  assert.equal(state.selectedClip, "idle");
});

test("captures deterministic pose keys by time", () => {
  const base = createMixamoAnimationDemoState({ clips: [{ id: "idle" }] });
  const first = reduceMixamoAnimationDemoState(base, {
    type: "animation/pose-captured",
    key: { at: 1, joints: { "right-arm": [0, 0, 0, 1] } },
  });
  const replaced = reduceMixamoAnimationDemoState(first, {
    type: "animation/pose-captured",
    key: { at: 1, joints: { "right-arm": [0, 0.1, 0, 0.995] } },
  });
  assert.equal(replaced.poseKeys.length, 1);
  assert.deepEqual(replaced.poseKeys[0].joints["right-arm"], [0, 0.1, 0, 0.995]);
});

test("bounds pose keys and sequence cues", () => {
  let state = createMixamoAnimationDemoState({ clips: [{ id: "idle" }] });
  for (let index = 0; index < MIXAMO_ANIMATION_MAX_POSE_KEYS + 10; index += 1) {
    state = reduceMixamoAnimationDemoState(state, {
      type: "animation/pose-captured",
      key: { at: index, joints: { head: [0, 0, 0, 1] } },
    });
  }
  assert.equal(state.poseKeys.length, MIXAMO_ANIMATION_MAX_POSE_KEYS);
  for (let index = 0; index < MIXAMO_ANIMATION_MAX_SEQUENCE + 10; index += 1) {
    state = reduceMixamoAnimationDemoState(state, {
      type: "animation/sequence-add",
      item: { id: `cue:${index}`, clipId: "idle" },
    });
  }
  assert.equal(state.sequence.length, MIXAMO_ANIMATION_MAX_SEQUENCE);
});
