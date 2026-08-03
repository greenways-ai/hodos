import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parseEDNString } from "edn-data";
import { start } from "../../kernel/runtime/hara-vm.mjs";
import { encodeHalValue } from "../../kernel/runtime/hal-transport.js";

const decode = (value) => parseEDNString(value, {
  mapAs: "object", setAs: "array", listAs: "array",
  keywordAs: "string", charAs: "string", objectKeysAs: "string",
});

const resources = {
  "gw.hodos.adaptor": fs.readFileSync(new URL("../../kernel/src/gw/hodos/adaptor.hal", import.meta.url), "utf8"),
  "gw.hodos.bundle": fs.readFileSync(new URL("../../kernel/src/gw/hodos/bundle.hal", import.meta.url), "utf8"),
  "gw.hodos.package": fs.readFileSync(new URL("../../kernel/src/gw/hodos/package.hal", import.meta.url), "utf8"),
  "gw.hodos.scene": fs.readFileSync(new URL("../../kernel/src/gw/hodos/scene.hal", import.meta.url), "utf8"),
  "gw.hodos.session": fs.readFileSync(new URL("../../kernel/src/gw/hodos/session.hal", import.meta.url), "utf8"),
  "gw.hodos.kernel": fs.readFileSync(new URL("../../kernel/src/gw/hodos/kernel.hal", import.meta.url), "utf8"),
};

async function kernel() {
  const runtime = await start({ resources });
  runtime.require("gw.hodos.kernel");
  return (method, args) => decode(runtime.eval(
    `(gw.hodos.kernel/dispatch ${encodeHalValue(method)} ${encodeHalValue(args)})`,
  ));
}

const project = {
  id: "local/current",
  title: "Spatial song",
  assets: [{ id: "asset-a", duration: 8 }],
  tracks: [
    {
      id: "track-a", name: "Guitar", gainDb: 0, pan: 0, mute: false,
      clips: [{ id: "clip-a", asset: "asset-a", startSeconds: 0, sourceStartSeconds: 0, duration: 4 }],
    },
    { id: "track-b", name: "Room", gainDb: 0, pan: 0, mute: false, clips: [] },
  ],
};

test("Hara creates tracks and moves a clip between them", async () => {
  const dispatch = await kernel();
  dispatch("session/open", ["track-session", { project: { id: "world" }, touchpoints: [] }]);
  dispatch("session/event", ["track-session", { "event/type": "studio/restore", project }]);
  dispatch("session/event", ["track-session", {
    "event/type": "studio/track-create",
    track: { id: "track-c", name: "New track", gainDb: 0, pan: 0, mute: false, clips: [] },
  }]);
  dispatch("session/event", ["track-session", {
    "event/type": "studio/clip-move-track",
    clip: "clip-a",
    track: "track-b",
    startSeconds: 2.5,
  }]);

  const state = dispatch("session/get", ["track-session"]).state;
  assert.deepEqual(state.studio.project.tracks.map(({ id }) => id), ["track-a", "track-b", "track-c"]);
  assert.equal(state.studio.project.tracks[0].clips.length, 0);
  assert.deepEqual(state.studio.project.tracks[1].clips[0], {
    id: "clip-a", asset: "asset-a", startSeconds: 2.5, sourceStartSeconds: 0, duration: 4,
  });
  assert.equal(state.revision, 3);
});

test("Hara owns world audio source placement, playback state, and removal", async () => {
  const dispatch = await kernel();
  dispatch("session/open", ["world-audio-session", { project: { id: "world" }, touchpoints: [] }]);
  dispatch("session/event", ["world-audio-session", { "event/type": "studio/restore", project }]);
  const placed = dispatch("session/event", ["world-audio-session", {
    "event/type": "world/drop",
    payload: {
      type: "studio/track",
      id: "world-source-1",
      track: "track-a",
      label: "World guitar",
      loop: true,
    },
    position: [1, 0.2, -2],
  }]);
  assert.deepEqual(placed.state.world.audioSources, [{
    id: "world-source-1",
    kind: "studio/track",
    track: "track-a",
    clip: null,
    label: "World guitar",
    position: [1, 0.2, -2],
    playing: true,
    loop: true,
    gainDb: 0,
  }]);
  assert.deepEqual(placed.effects.map(({ effect, method }) => `${effect}/${method}`), [
    "scene/sync-audio-sources",
    "audio/sync-world-sources",
  ]);

  const paused = dispatch("session/event", ["world-audio-session", {
    "event/type": "world/audio-toggle", source: "world-source-1",
  }]);
  assert.equal(paused.state.world.audioSources[0].playing, false);

  const removed = dispatch("session/event", ["world-audio-session", {
    "event/type": "world/audio-remove", source: "world-source-1",
  }]);
  assert.deepEqual(removed.state.world.audioSources, []);
  assert.deepEqual(removed.effects[0], {
    effect: "scene", method: "sync-audio-sources", args: [[]],
  });
});

test("world audio placement rejects missing studio references", async () => {
  const dispatch = await kernel();
  dispatch("session/open", ["invalid-source", { project: { id: "world" }, touchpoints: [] }]);
  dispatch("session/event", ["invalid-source", { "event/type": "studio/restore", project }]);
  assert.throws(() => dispatch("session/event", ["invalid-source", {
    "event/type": "world/drop",
    payload: { type: "studio/clip", id: "bad", clip: "missing", label: "Missing" },
    position: [0, 0, 0],
  }]), /Unknown studio clip/);
});
