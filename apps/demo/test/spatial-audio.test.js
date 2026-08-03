import assert from "node:assert/strict";
import test from "node:test";
import { projectForWorldSource, SpatialAudioRuntime } from "../src/spatial-audio.js";

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

test("editable source values update the existing HRTF graph", () => {
  const parameter = () => ({
    value: 0,
    setValueAtTime(value) { this.value = value; },
  });
  const runtime = new SpatialAudioRuntime({ AudioContextClass: class {} });
  runtime.context = { currentTime: 2 };
  const entry = {
    node: { loop: false },
    gain: { gain: parameter() },
    panner: {
      positionX: parameter(), positionY: parameter(), positionZ: parameter(),
      panningModel: "equalpower", distanceModel: "linear",
      refDistance: 0, maxDistance: 0, rolloffFactor: 0,
    },
  };
  runtime.configureEntry(entry, {
    id: "world-1",
    position: [4, 1, -3],
    loop: true,
    gainDb: -6,
    refDistance: 2,
    maxDistance: 75,
    rolloffFactor: 0.5,
  });
  assert.equal(entry.node.loop, true);
  assert.ok(Math.abs(entry.gain.gain.value - (10 ** (-6 / 20))) < 1e-9);
  assert.equal(entry.panner.panningModel, "HRTF");
  assert.equal(entry.panner.distanceModel, "inverse");
  assert.equal(entry.panner.refDistance, 2);
  assert.equal(entry.panner.maxDistance, 75);
  assert.equal(entry.panner.rolloffFactor, 0.5);
  assert.deepEqual(
    [entry.panner.positionX.value, entry.panner.positionY.value, entry.panner.positionZ.value],
    [4, 1, -3],
  );
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
