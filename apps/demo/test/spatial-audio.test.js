import assert from "node:assert/strict";
import test from "node:test";
import { projectForWorldSource } from "../src/spatial-audio.js";

const project = {
  id: "local/current",
  title: "Spatial test",
  assets: [
    { id: "asset-a", duration: 8 },
    { id: "asset-b", duration: 4 },
  ],
  tracks: [
    {
      id: "track-a",
      name: "Guitar",
      gainDb: -3,
      pan: 0.5,
      mute: true,
      clips: [
        { id: "clip-a", asset: "asset-a", startSeconds: 4, sourceStartSeconds: 1, duration: 3 },
        { id: "clip-b", asset: "asset-b", startSeconds: 9, sourceStartSeconds: 0, duration: 2 },
      ],
    },
  ],
};

test("spatial track projects its clip graph relative to the first clip", () => {
  const selected = projectForWorldSource({
    id: "world-1", kind: "studio/track", track: "track-a", label: "World guitar",
  }, project);
  assert.equal(selected.tracks.length, 1);
  assert.equal(selected.tracks[0].mute, false);
  assert.equal(selected.tracks[0].pan, 0);
  assert.deepEqual(selected.tracks[0].clips.map(({ startSeconds }) => startSeconds), [0, 5]);
  assert.deepEqual(selected.assets.map(({ id }) => id), ["asset-a", "asset-b"]);
});

test("spatial clip projects one source range from zero", () => {
  const selected = projectForWorldSource({
    id: "world-2", kind: "studio/clip", clip: "clip-b", track: "track-a",
  }, project);
  assert.equal(selected.tracks[0].clips.length, 1);
  assert.deepEqual(selected.tracks[0].clips[0], {
    id: "clip-b", asset: "asset-b", startSeconds: 0, sourceStartSeconds: 0, duration: 2,
  });
  assert.deepEqual(selected.assets.map(({ id }) => id), ["asset-b"]);
});

test("spatial sources fail closed for missing references", () => {
  assert.throws(
    () => projectForWorldSource({ id: "missing", kind: "studio/track", track: "absent" }, project),
    /unknown track/,
  );
  assert.throws(
    () => projectForWorldSource({ id: "missing", kind: "studio/clip", clip: "absent" }, project),
    /unknown clip/,
  );
});
