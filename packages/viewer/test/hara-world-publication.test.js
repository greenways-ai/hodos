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
  repository: {
    owner: "greenways-worlds",
    repo: "room",
    url: "https://github.com/greenways-worlds/room",
  },
  commit: "a".repeat(40),
  project: { id: "greenways-worlds/room", version: "1.0.0" },
  touchpoints: [],
};

const proposalIdentity = {
  repository: world.repository,
  commit: world.commit,
  project: world.project,
};

const project = {
  id: "local/current",
  title: "Review song",
  assets: [{ id: "asset-a", duration: 8 }],
  tracks: [{
    id: "track-a",
    name: "Guitar",
    gainDb: 0,
    pan: 0,
    mute: false,
    clips: [{ id: "clip-a", asset: "asset-a", startSeconds: 0, sourceStartSeconds: 0, duration: 4 }],
  }],
};

function source(id, overrides = {}) {
  return {
    id,
    kind: "studio/track",
    track: "track-a",
    clip: null,
    label: id,
    position: [0, 0.2, 0],
    playing: true,
    loop: true,
    gainDb: 0,
    refDistance: 1,
    maxDistance: 30,
    rolloffFactor: 1,
    ...overrides,
  };
}

async function preparedSession(id) {
  const dispatch = await kernel();
  dispatch("session/open", [id, world]);
  dispatch("session/event", [id, { "event/type": "studio/restore", project }]);
  dispatch("session/event", [id, {
    "event/type": "world/drop",
    payload: { type: "studio/track", id: "source-a", track: "track-a", label: "source-a" },
    position: [0, 0.2, 0],
  }]);
  return dispatch;
}

function proposal(baseRevision = 1) {
  return {
    format: "hodos-world-draft-proposal",
    version: "0.1.0",
    id: "proposal-1",
    identity: proposalIdentity,
    baseRevision,
    changes: [
      {
        id: "source:source-a",
        op: "replace",
        source: "source-a",
        before: source("source-a"),
        after: source("source-a", { position: [2, 1, -3], gainDb: -6 }),
        fields: [],
      },
      {
        id: "source:source-b",
        op: "add",
        source: "source-b",
        before: null,
        after: source("source-b", { position: [-2, 0.2, 1] }),
        fields: [],
      },
    ],
    selected: ["source:source-a", "source:source-b"],
    summary: { add: 1, remove: 0, replace: 1, unchanged: 0 },
  };
}

test("Hara reviews a selected subset as one reversible draft transaction", async () => {
  const dispatch = await preparedSession("review-session");
  const proposed = dispatch("session/event", ["review-session", {
    "event/type": "world/draft-propose",
    proposal: proposal(),
  }]);
  assert.equal(proposed.state.world.review.proposal.id, "proposal-1");
  assert.deepEqual(proposed.state.world.review.selected, ["source:source-a", "source:source-b"]);

  dispatch("session/event", ["review-session", {
    "event/type": "world/draft-review-toggle",
    change: "source:source-b",
  }]);
  const accepted = dispatch("session/event", ["review-session", {
    "event/type": "world/draft-review-accept",
  }]);
  assert.equal(accepted.state.world.audioSources.length, 1);
  assert.deepEqual(accepted.state.world.audioSources[0].position, [2, 1, -3]);
  assert.equal(accepted.state.world.audioSources[0].gainDb, -6);
  assert.equal(accepted.state.world.review.proposal, null);
  assert.equal(accepted.state.world.draft.history.undo.length, 2);
  assert.deepEqual(accepted.effects.map(({ effect, method }) => `${effect}/${method}`), [
    "scene/sync-audio-sources",
    "audio/sync-world-sources",
    "storage/save-world-draft",
  ]);

  const undone = dispatch("session/event", ["review-session", {
    "event/type": "world/history-undo",
  }]);
  assert.deepEqual(undone.state.world.audioSources[0].position, [0, 0.2, 0]);
});

test("Hara marks proposals stale when the live draft changes", async () => {
  const dispatch = await preparedSession("stale-session");
  dispatch("session/event", ["stale-session", {
    "event/type": "world/draft-propose",
    proposal: proposal(),
  }]);
  const moved = dispatch("session/event", ["stale-session", {
    "event/type": "world/audio-move",
    source: "source-a",
    position: [5, 0.2, 0],
  }]);
  assert.equal(moved.state.world.review.stale, true);
  assert.throws(
    () => dispatch("session/event", ["stale-session", {
      "event/type": "world/draft-review-accept",
    }]),
    /stale/,
  );
});

test("Hara emits repository and Hestia publication effects and stores receipts", async () => {
  const dispatch = await preparedSession("publish-session");
  const repository = dispatch("session/event", ["publish-session", {
    "event/type": "world/publish-repository",
  }]);
  assert.deepEqual(repository.effects.map(({ effect, method }) => `${effect}/${method}`), [
    "publication/repository-patch",
  ]);

  const hestia = dispatch("session/event", ["publish-session", {
    "event/type": "world/publish-hestia",
    room: "hestia:room:review",
  }]);
  assert.equal(hestia.effects[0].effect, "publication");
  assert.equal(hestia.effects[0].method, "hestia-contribution");
  assert.equal(hestia.effects[0].args[2], "hestia:room:review");

  const completed = dispatch("session/event", ["publish-session", {
    "event/type": "world/publication-complete",
    receipt: {
      target: "hestia",
      room: "hestia:room:review",
      digest: `sha256:${"b".repeat(64)}`,
    },
  }]);
  assert.equal(completed.state.world.publications.length, 1);
  assert.equal(completed.state.world.publications[0].target, "hestia");
});
