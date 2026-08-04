import assert from "node:assert/strict";
import test from "node:test";
import {
  diffWorldDrafts,
  parseWorldDraftProposal,
  readWorldDraftProposal,
} from "../src/world-draft-review.js";
import { worldDraftExport } from "../src/world-draft-storage.js";

const identity = {
  repository: {
    owner: "greenways-worlds",
    repo: "room",
    url: "https://github.com/greenways-worlds/room",
  },
  commit: "a".repeat(40),
  project: { id: "greenways-worlds/room", version: "1.0.0" },
};

const source = (id, overrides = {}) => ({
  id,
  kind: "studio/track",
  track: `track-${id}`,
  clip: null,
  label: id.toUpperCase(),
  position: [0, 0, 0],
  playing: true,
  loop: true,
  gainDb: 0,
  refDistance: 1,
  maxDistance: 30,
  rolloffFactor: 1,
  ...overrides,
});

const entity = (id, overrides = {}) => ({
  id,
  name: id.toUpperCase(),
  kind: "box",
  parent: null,
  visible: true,
  locked: false,
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  components: { primitive: { shape: "box", color: "#c8ad73", opacity: 1 } },
  ...overrides,
});

const current = {
  format: "hodos-world-draft",
  version: "0.1.0",
  revision: 4,
  audioSources: [source("a"), source("remove")],
  entities: [entity("cube"), entity("old")],
};

const candidate = {
  format: "hodos-world-draft",
  version: "0.1.0",
  revision: 9,
  audioSources: [
    source("a", { position: [2, 1, -3], gainDb: -6 }),
    source("b", { maxDistance: 80 }),
  ],
  entities: [
    entity("cube", {
      transform: { position: [4, 0, 0], rotation: [0, 45, 0], scale: [2, 1, 1] },
    }),
    entity("light", {
      name: "Key Light",
      kind: "point-light",
      components: { light: { type: "point", color: "#fff1ca", intensity: 2, range: 15 } },
    }),
  ],
};

test("world draft diff reports entity and source changes with fields", () => {
  const result = diffWorldDrafts(current, candidate);
  assert.deepEqual(result.summary, { add: 2, remove: 2, replace: 2, unchanged: 0 });
  assert.deepEqual(result.changes.map(({ id, collection, op }) => [id, collection, op]), [
    ["entity:cube", "entities", "replace"],
    ["entity:light", "entities", "add"],
    ["entity:old", "entities", "remove"],
    ["source:a", "audioSources", "replace"],
    ["source:b", "audioSources", "add"],
    ["source:remove", "audioSources", "remove"],
  ]);
  assert.deepEqual(result.changes[0].fields.map(({ field }) => field), ["transform"]);
  assert.deepEqual(result.changes[3].fields.map(({ field }) => field), ["gainDb", "position"]);
});

test("world draft export becomes an exact-world Hara proposal", () => {
  const envelope = worldDraftExport(identity, candidate, {
    exportedAt: "2026-08-04T00:00:00.000Z",
  });
  const proposal = parseWorldDraftProposal(JSON.stringify(envelope), {
    expectedIdentity: identity,
    currentDraft: current,
    id: "proposal-test",
  });
  assert.equal(proposal.id, "proposal-test");
  assert.equal(proposal.baseRevision, 4);
  assert.equal(proposal.changes.length, 6);
  assert.deepEqual(proposal.selected, [
    "entity:cube", "entity:light", "entity:old",
    "source:a", "source:b", "source:remove",
  ]);
  assert.equal(proposal.identity.commit, identity.commit);
});

test("world draft import rejects identity drift and duplicate item ids", () => {
  const envelope = worldDraftExport(identity, candidate);
  assert.throws(
    () => parseWorldDraftProposal(JSON.stringify(envelope), {
      expectedIdentity: { ...identity, commit: "b".repeat(40) },
      currentDraft: current,
    }),
    /different repository commit or project/,
  );
  const duplicateSource = {
    ...envelope,
    draft: { ...candidate, audioSources: [source("a"), source("a")] },
  };
  assert.throws(
    () => parseWorldDraftProposal(JSON.stringify(duplicateSource), {
      expectedIdentity: identity,
      currentDraft: current,
    }),
    /duplicate source id/,
  );
  const duplicateEntity = {
    ...envelope,
    draft: { ...candidate, entities: [entity("cube"), entity("cube")] },
  };
  assert.throws(
    () => parseWorldDraftProposal(JSON.stringify(duplicateEntity), {
      expectedIdentity: identity,
      currentDraft: current,
    }),
    /duplicate entity id/,
  );
});

test("file import is bounded before parsing", async () => {
  const envelope = JSON.stringify(worldDraftExport(identity, candidate));
  const proposal = await readWorldDraftProposal({
    name: "room.hodos-world.json",
    size: envelope.length,
    text: async () => envelope,
  }, {
    expectedIdentity: identity,
    currentDraft: current,
    id: "file-proposal",
  });
  assert.equal(proposal.id, "file-proposal");
  await assert.rejects(
    readWorldDraftProposal({
      name: "huge.hodos-world.json",
      size: 3 * 1024 * 1024,
      text: async () => "{}",
    }, { expectedIdentity: identity, currentDraft: current }),
    /exceeds/,
  );
});
