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
  "gw.hodos.session-draft": fs.readFileSync(new URL("../../kernel/src/gw/hodos/session_draft.hal", import.meta.url), "utf8"),
  "gw.hodos.session-publication": fs.readFileSync(new URL("../../kernel/src/gw/hodos/session_publication.hal", import.meta.url), "utf8"),
  "gw.hodos.session-authoring": fs.readFileSync(new URL("../../kernel/src/gw/hodos/session_authoring.hal", import.meta.url), "utf8"),
  "gw.hodos.kernel": fs.readFileSync(new URL("../../kernel/src/gw/hodos/kernel.hal", import.meta.url), "utf8"),
};

async function kernel() {
  const runtime = await start({ resources });
  runtime.require("gw.hodos.kernel");
  return (method, args) => decode(runtime.eval(
    `(gw.hodos.kernel/dispatch ${encodeHalValue(method)} ${encodeHalValue(args)})`,
  ));
}

const world = {
  repository: { owner: "greenways-worlds", repo: "room", url: "https://github.com/greenways-worlds/room" },
  commit: "a".repeat(40),
  project: { id: "greenways-worlds/room", version: "1.0.0" },
  touchpoints: [],
};

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
  dispatch("session/open", ["track-session", world]);
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

test("Hara world draft owns placement, transforms, acoustics, persistence and undo", async () => {
  const dispatch = await kernel();
  dispatch("session/open", ["world-draft-session", world]);
  dispatch("session/event", ["world-draft-session", { "event/type": "studio/restore", project }]);

  const placed = dispatch("session/event", ["world-draft-session", {
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
  assert.deepEqual(placed.state.world.draft.audioSources, [{
    id: "world-source-1",
    kind: "studio/track",
    track: "track-a",
    clip: null,
    label: "World guitar",
    position: [1, 0.2, -2],
    playing: true,
    loop: true,
    gainDb: 0,
    refDistance: 1,
    maxDistance: 30,
    rolloffFactor: 1,
  }]);
  assert.deepEqual(placed.state.world.draft.entities, []);
  assert.equal(placed.state.world.draft.dirty, true);
  assert.equal(placed.state.world.draft.history.undo.length, 1);
  const effects = placed.effects.map(({ effect, method }) => `${effect}/${method}`);
  assert.ok(effects.includes("scene/sync-world-entities"));
  assert.ok(effects.includes("scene/sync-editor-document"));
  assert.ok(effects.includes("audio/sync-world-sources"));
  assert.ok(effects.includes("storage/save-world-draft"));
  const storage = placed.effects.find(({ effect, method }) => effect === "storage" && method === "save-world-draft");
  assert.equal(storage.args[1].format, "hodos-world-draft");
  assert.equal(storage.args[1].revision, 1);
  assert.deepEqual(storage.args[1].entities, []);

  const saved = dispatch("session/event", ["world-draft-session", {
    "event/type": "world/draft-saved", revision: 1,
  }]);
  assert.equal(saved.state.world.draft.dirty, false);

  dispatch("session/event", ["world-draft-session", {
    "event/type": "world/audio-move", source: "world-source-1", position: [3, 1, 4],
  }]);
  dispatch("session/event", ["world-draft-session", {
    "event/type": "world/audio-gain", source: "world-source-1", gainDb: -6,
  }]);
  dispatch("session/event", ["world-draft-session", {
    "event/type": "world/audio-range", source: "world-source-1",
    refDistance: 2, maxDistance: 80, rolloffFactor: 0.75,
  }]);
  let state = dispatch("session/get", ["world-draft-session"]).state;
  assert.deepEqual(state.world.audioSources[0].position, [3, 1, 4]);
  assert.equal(state.world.audioSources[0].gainDb, -6);
  assert.equal(state.world.audioSources[0].maxDistance, 80);
  assert.equal(state.world.draft.history.undo.length, 4);

  const undone = dispatch("session/event", ["world-draft-session", {
    "event/type": "world/history-undo",
  }]);
  assert.equal(undone.state.world.audioSources[0].maxDistance, 30);
  assert.equal(undone.state.world.draft.history.redo.length, 1);

  const exported = dispatch("session/event", ["world-draft-session", {
    "event/type": "world/draft-export",
  }]);
  const exportEffect = exported.effects.find(({ effect, method }) => effect === "export" && method === "world-draft");
  assert.equal(exportEffect.args[1].audioSources[0].gainDb, -6);
  assert.deepEqual(exportEffect.args[1].entities, []);
});

test("stored world drafts restore without creating an extra persistence write", async () => {
  const dispatch = await kernel();
  dispatch("session/open", ["draft-restore", world]);
  dispatch("session/event", ["draft-restore", { "event/type": "studio/restore", project }]);
  const restored = dispatch("session/event", ["draft-restore", {
    "event/type": "world/draft-restore",
    draft: {
      format: "hodos-world-draft",
      version: "0.1.0",
      revision: 7,
      audioSources: [{
        id: "saved-source", kind: "studio/clip", track: "track-a", clip: "clip-a",
        label: "Saved clip", position: [0, 1, 2], playing: false, loop: false,
        gainDb: -3, refDistance: 1, maxDistance: 12, rolloffFactor: 1,
      }],
      entities: [],
      collections: [],
      assets: [],
      prefabs: [],
      animations: [{ id: "main", name: "Main", duration: 10, fps: 30, tracks: [] }],
    },
  }]);
  assert.equal(restored.state.world.draft.revision, 7);
  assert.equal(restored.state.world.draft.dirty, false);
  assert.equal(restored.state.world.audioSources[0].id, "saved-source");
  const effects = restored.effects.map(({ effect, method }) => `${effect}/${method}`);
  assert.ok(effects.includes("scene/sync-world-entities"));
  assert.ok(effects.includes("scene/sync-editor-document"));
  assert.ok(effects.includes("audio/sync-world-sources"));
});

test("world audio placement rejects missing studio references", async () => {
  const dispatch = await kernel();
  dispatch("session/open", ["invalid-source", world]);
  dispatch("session/event", ["invalid-source", { "event/type": "studio/restore", project }]);
  assert.throws(() => dispatch("session/event", ["invalid-source", {
    "event/type": "world/drop",
    payload: { type: "studio/clip", id: "bad", clip: "missing", label: "Missing" },
    position: [0, 0, 0],
  }]), /Unknown studio clip/);
});
