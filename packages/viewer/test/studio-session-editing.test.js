import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parseEDNString } from "edn-data";
import { start } from "../../kernel/runtime/hara-vm.mjs";
import { encodeHalValue } from "../../kernel/runtime/hal-transport.js";

const resources = {
  "gw.hodos.adaptor": fs.readFileSync(new URL("../../core/src/gw/hodos/adaptor.hal", import.meta.url), "utf8"),
  "gw.hodos.bundle": fs.readFileSync(new URL("../../core/src/gw/hodos/bundle.hal", import.meta.url), "utf8"),
  "gw.hodos.package": fs.readFileSync(new URL("../../core/src/gw/hodos/package.hal", import.meta.url), "utf8"),
  "gw.hodos.scene": fs.readFileSync(new URL("../../core/src/gw/hodos/scene.hal", import.meta.url), "utf8"),
  "gw.hodos.session": fs.readFileSync(new URL("../../core/src/gw/hodos/session.hal", import.meta.url), "utf8"),
  "gw.hodos.session-draft": fs.readFileSync(new URL("../../addon-drafts/src/gw/hodos/session_draft.hal", import.meta.url), "utf8"),
  "gw.hodos.session-publication": fs.readFileSync(new URL("../../addon-publication/src/gw/hodos/session_publication.hal", import.meta.url), "utf8"),
  "gw.hodos.session-authoring": fs.readFileSync(new URL("../../addon-authoring/src/gw/hodos/session_authoring.hal", import.meta.url), "utf8"),
  "gw.hodos.kernel": fs.readFileSync(new URL("../../kernel/src/gw/hodos/kernel.hal", import.meta.url), "utf8"),
};

const decode = (value) => parseEDNString(value, {
  mapAs: "object", setAs: "array", listAs: "array",
  keywordAs: "string", charAs: "string", objectKeysAs: "string",
});

test("Hara applies structural clip edits as reversible project commands", async () => {
  const runtime = await start({ resources });
  runtime.require("gw.hodos.kernel");
  const dispatch = (method, args) => runtime.eval(
    `(gw.hodos.kernel/dispatch ${encodeHalValue(method)} ${encodeHalValue(args)})`,
  );
  const event = (payload) => dispatch("session/event", ["clip-edit-test", payload]);
  const state = () => decode(dispatch("session/get", ["clip-edit-test"])).state;

  dispatch("session/open", ["clip-edit-test", { project: { id: "world" }, touchpoints: [] }]);
  event({
    "event/type": "studio/restore",
    project: {
      id: "local/current",
      title: "Clip edits",
      assets: [{ id: "sha256:audio", duration: 8 }],
      tracks: [{
        id: "track-1",
        name: "Track",
        gainDb: 0,
        mute: false,
        clips: [{
          id: "clip-1",
          asset: "sha256:audio",
          startSeconds: 0,
          sourceStartSeconds: 0,
          duration: 4,
        }],
      }],
    },
  });

  event({
    "event/type": "studio/clip-replace",
    clip: {
      id: "clip-1",
      asset: "sha256:audio",
      startSeconds: 1,
      sourceStartSeconds: 1,
      duration: 3,
    },
  });
  event({
    "event/type": "studio/clip-split",
    target: "clip-1",
    left: {
      id: "clip-1",
      asset: "sha256:audio",
      startSeconds: 1,
      sourceStartSeconds: 1,
      duration: 1.5,
    },
    right: {
      id: "clip-2",
      asset: "sha256:audio",
      startSeconds: 2.5,
      sourceStartSeconds: 2.5,
      duration: 1.5,
    },
  });
  event({
    "event/type": "studio/clip-insert-after",
    target: "clip-2",
    clip: {
      id: "clip-3",
      asset: "sha256:audio",
      startSeconds: 4.25,
      sourceStartSeconds: 2.5,
      duration: 1.5,
    },
  });
  event({ "event/type": "studio/clip-delete", clip: "clip-1" });

  const edited = state();
  assert.deepEqual(
    edited.studio.project.tracks[0].clips.map(({ id }) => id),
    ["clip-2", "clip-3"],
  );
  assert.equal(edited.revision, 5);

  event({ "event/type": "studio/history-undo" });
  const undone = state();
  assert.deepEqual(
    undone.studio.project.tracks[0].clips.map(({ id }) => id),
    ["clip-1", "clip-2", "clip-3"],
  );
  assert.equal(undone.revision, 6);

  assert.throws(() => event({
    "event/type": "studio/clip-insert-after",
    target: "clip-2",
    clip: {
      id: "clip-3",
      asset: "sha256:audio",
      startSeconds: 6,
      sourceStartSeconds: 0,
      duration: 1,
    },
  }), /clip id already exists/);
});
