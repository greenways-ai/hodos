import assert from "node:assert/strict";
import test from "node:test";
import { MemoryStudioBackend } from "../src/studio-storage.js";
import {
  createWorldDraftStore,
  validateWorldDraft,
  worldDraftExport,
  worldDraftKey,
} from "../src/world-draft-storage.js";

const identity = {
  repository: { owner: "greenways-worlds", repo: "room", url: "https://github.com/greenways-worlds/room" },
  commit: "a".repeat(40),
  project: { id: "greenways-worlds/room", version: "1.0.0" },
};

const draft = {
  format: "hodos-world-draft",
  version: "0.1.0",
  revision: 4,
  audioSources: [{
    id: "source-1",
    kind: "studio/track",
    track: "track-1",
    clip: null,
    label: "Guitar",
    position: [1, 0.5, -2],
    playing: true,
    loop: true,
    gainDb: -3,
    refDistance: 1,
    maxDistance: 40,
    rolloffFactor: 1,
  }],
};

test("world draft storage is isolated by immutable world identity", async () => {
  const store = createWorldDraftStore({ backend: new MemoryStudioBackend() });
  assert.equal(
    worldDraftKey(identity),
    `https://github.com/greenways-worlds/room@${"a".repeat(40)}#greenways-worlds/room`,
  );
  await store.save(identity, draft);
  assert.deepEqual(await store.load(identity), draft);
  assert.equal(await store.load({ ...identity, commit: "b".repeat(40) }), null);
});

test("queued writes preserve the latest world draft revision", async () => {
  class DelayedBackend extends MemoryStudioBackend {
    async write(path, value) {
      const record = JSON.parse(new TextDecoder().decode(value));
      if (record.draft.revision === 1) await new Promise((resolve) => setTimeout(resolve, 20));
      return super.write(path, value);
    }
  }
  const store = createWorldDraftStore({ backend: new DelayedBackend() });
  const first = store.save(identity, { ...draft, revision: 1 });
  const second = store.save(identity, { ...draft, revision: 2 });
  await Promise.all([first, second]);
  assert.equal((await store.load(identity)).revision, 2);
});

test("world draft validation and export fail closed", () => {
  assert.throws(
    () => validateWorldDraft({ ...draft, audioSources: [{ ...draft.audioSources[0], position: [0, Number.NaN, 0] }] }),
    /position must be finite/,
  );
  const exported = worldDraftExport(identity, draft, { exportedAt: "2026-08-04T00:00:00.000Z" });
  assert.equal(exported.format, "hodos-world-draft-export");
  assert.equal(exported.exportedAt, "2026-08-04T00:00:00.000Z");
  assert.deepEqual(exported.draft, draft);
});
