import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { start } from "../../kernel/runtime/hara-vm.mjs";
import { encodeHalValue } from "../../kernel/runtime/hal-transport.js";

const resources = {
  "gw.hodos.adaptor": fs.readFileSync(new URL("../../kernel/src/gw/hodos/adaptor.hal", import.meta.url), "utf8"),
  "gw.hodos.bundle": fs.readFileSync(new URL("../../kernel/src/gw/hodos/bundle.hal", import.meta.url), "utf8"),
  "gw.hodos.package": fs.readFileSync(new URL("../../kernel/src/gw/hodos/package.hal", import.meta.url), "utf8"),
  "gw.hodos.scene": fs.readFileSync(new URL("../../kernel/src/gw/hodos/scene.hal", import.meta.url), "utf8"),
  "gw.hodos.session": fs.readFileSync(new URL("../../kernel/src/gw/hodos/session.hal", import.meta.url), "utf8"),
  "gw.hodos.kernel": fs.readFileSync(new URL("../../kernel/src/gw/hodos/kernel.hal", import.meta.url), "utf8"),
};

test("browser VM exposes the HAL kernel through its generated adaptor surface", async () => {
  const runtime = await start({ resources });
  runtime.require("gw.hodos.kernel");
  assert.equal(
    runtime.eval('(get (get gw.hodos.kernel/SURFACE "world/open") "action")'),
    '"@hodos/world/open"',
  );
  assert.equal(
    runtime.eval('(gw.hodos.kernel/dispatch "catalog/search" [[{"name" "apartment"} {"name" "splat-garden"}] "garden"])'),
    '[{"name" "splat-garden"}]',
  );
  assert.match(runtime.eval('(gw.hodos.kernel/dispatch "app/capabilities" [])'), /"ui\/surfaces"/);
});

test("Hara carries session and studio state across touchpoint events", async () => {
  const runtime = await start({ resources });
  runtime.require("gw.hodos.kernel");
  const dispatch = (method, args) => runtime.eval(
    `(gw.hodos.kernel/dispatch ${encodeHalValue(method)} ${encodeHalValue(args)})`,
  );
  dispatch("session/open", ["session-test", { project: { id: "world" }, touchpoints: [] }]);
  const opened = dispatch("session/event", ["session-test", {
    "event/type": "touchpoint/activate",
    touchpoint: {
      id: "studio-console",
      label: "Open Studio",
      surface: "hodos/studio",
      presentation: "focus-overlay",
      config: { project: "local/current" },
    },
  }]);
  assert.match(opened, /"open-surface"/);
  assert.match(opened, /"hodos\/studio"/);

  dispatch("session/event", ["session-test", {
    "event/type": "studio/import",
    asset: { id: "sha256:audio", name: "track.wav" },
    track: { id: "track-1", name: "Track", gainDb: 0, mute: false, clips: [{ id: "clip-1", asset: "sha256:audio", startSeconds: 0, sourceStartSeconds: 0, duration: 4 }] },
  }]);
  dispatch("session/event", ["session-test", {
    "event/type": "studio/import",
    asset: { id: "sha256:audio", name: "track.wav" },
    track: { id: "track-2", name: "Track copy", gainDb: 0, mute: false, clips: [{ id: "clip-2", asset: "sha256:audio", startSeconds: 0, sourceStartSeconds: 0, duration: 4 }] },
  }]);
  const state = dispatch("session/get", ["session-test"]);
  assert.match(state, /"track-1"/);
  assert.match(state, /"track-2"/);
  assert.equal((state.match(/"sha256:audio"/g) ?? []).length, 3);
  assert.match(state, /"revision" 3/);

  dispatch("session/event", ["session-test", {
    "event/type": "studio/clip-move", clip: "clip-1", startSeconds: 3.25,
  }]);
  dispatch("session/event", ["session-test", {
    "event/type": "studio/track-gain", track: "track-1", gainDb: -6,
  }]);
  dispatch("session/event", ["session-test", {
    "event/type": "studio/track-mute", track: "track-2", mute: true,
  }]);
  const edited = dispatch("session/get", ["session-test"]);
  assert.match(edited, /"startSeconds" 3.25/);
  assert.match(edited, /"gainDb" -6/);
  assert.match(edited, /"mute" true/);
  assert.match(edited, /"revision" 6/);
});

test("Hara restores a durable browser project into the active session", async () => {
  const runtime = await start({ resources });
  runtime.require("gw.hodos.kernel");
  const dispatch = (method, args) => runtime.eval(
    `(gw.hodos.kernel/dispatch ${encodeHalValue(method)} ${encodeHalValue(args)})`,
  );
  dispatch("session/open", ["restore-test", { project: { id: "world" }, touchpoints: [] }]);
  const restored = dispatch("session/event", ["restore-test", {
    "event/type": "studio/restore",
    project: {
      id: "local/current",
      title: "Restored song",
      assets: [{ id: "sha256:saved", storage: { type: "opfs", key: "assets/saved.bin" } }],
      tracks: [{ id: "saved-track", gainDb: 0, mute: false, clips: [{ id: "saved-clip", asset: "sha256:saved", startSeconds: 0, sourceStartSeconds: 0, duration: 1 }] }],
    },
  }]);
  assert.match(restored, /"Restored song"/);
  assert.match(restored, /"saved-track"/);
  assert.match(restored, /"revision" 1/);
});

test("host objects are encoded as EDN maps for HAL dispatch", async () => {
  const runtime = await start({ resources });
  runtime.require("gw.hodos.kernel");
  const graph = {
    repository: { owner: "greenways-worlds", repo: "playbot", url: "https://github.com/greenways-worlds/playbot" },
    layers: [{ id: "playbot", assetUrl: "https://raw.githubusercontent.com/greenways-worlds/playbot/commit/world/playbot/lod-meta.json" }],
    diagnostics: [],
  };
  const source = `(gw.hodos.kernel/dispatch "world/render" ${encodeHalValue([graph])})`;
  const result = runtime.eval(source);
  assert.match(result, /"scene"/);
  assert.match(result, /"render-world"/);
});

test("HAL transport rejects invalid and circular host values with their path", () => {
  assert.throws(() => encodeHalValue({ graph: { scale: Number.NaN } }), /\.graph\.scale must be a finite number/);
  const value = { graph: {} };
  value.graph.parent = value;
  assert.throws(() => encodeHalValue(value), /\.graph\.parent contains a circular reference/);
});
