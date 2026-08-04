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

const entity = {
  id: "cube-1",
  name: "Cube",
  kind: "box",
  parent: null,
  collection: "set",
  visible: true,
  locked: false,
  origin: [0, 0, 0],
  transform: {
    position: [1, 0.5, -2],
    rotation: [0, 45, 0],
    scale: [1, 2, 1],
  },
  components: {
    primitive: { shape: "box", color: "#c8ad73", opacity: 1 },
    script: {
      language: "hara",
      enabled: true,
      events: ["world/start"],
      source: '(fn [event entity world] {"entity" entity})',
    },
  },
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
  entities: [entity],
  collections: [{ id: "set", name: "Set Dressing", parent: null, visible: true, locked: false }],
  assets: [{ id: "chair", name: "Chair", kind: "gltf", url: "https://example.test/chair.glb", thumbnail: null, metadata: {} }],
  prefabs: [{ id: "cube-prefab", name: "Cube", description: "", rootIds: ["cube-1"], entities: [{ ...entity, collection: null }] }],
  animations: [{
    id: "main",
    name: "Main",
    duration: 4,
    fps: 30,
    tracks: [{
      id: "cube-position",
      entity: "cube-1",
      property: "position",
      enabled: true,
      keyframes: [
        { id: "start", time: 0, value: [1, 0.5, -2], easing: "linear" },
        { id: "end", time: 4, value: [4, 0.5, -2], easing: "linear" },
      ],
    }],
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

test("world draft validates scene transforms and hierarchy", () => {
  assert.throws(
    () => validateWorldDraft({
      ...draft,
      entities: [{ ...entity, transform: { ...entity.transform, position: [0, Number.NaN, 0] } }],
    }),
    /position must contain three finite numbers/,
  );
  assert.throws(
    () => validateWorldDraft({
      ...draft,
      entities: [{ ...entity, transform: { ...entity.transform, scale: [1, 0, 1] } }],
    }),
    /scale values must be positive/,
  );
  assert.throws(
    () => validateWorldDraft({ ...draft, entities: [entity, { ...entity }] }),
    /duplicate entity id/,
  );
  assert.throws(
    () => validateWorldDraft({ ...draft, entities: [{ ...entity, parent: "missing" }] }),
    /unknown parent/,
  );
  assert.throws(
    () => validateWorldDraft({ ...draft, entities: [{ ...entity, collection: "missing" }] }),
    /unknown collection/,
  );
});

test("world draft validates collections, prefabs, animations and scripts", () => {
  assert.throws(
    () => validateWorldDraft({
      ...draft,
      collections: [{ id: "set", parent: "missing" }],
    }),
    /collection 0 references an unknown parent/,
  );
  assert.throws(
    () => validateWorldDraft({
      ...draft,
      prefabs: [{ id: "bad", entities: [{ ...entity, parent: "external", collection: null }] }],
    }),
    /external parent/,
  );
  assert.throws(
    () => validateWorldDraft({
      ...draft,
      animations: [{ ...draft.animations[0], tracks: [{ ...draft.animations[0].tracks[0], entity: "missing" }] }],
    }),
    /unknown entity/,
  );
  assert.throws(
    () => validateWorldDraft({
      ...draft,
      entities: [{ ...entity, components: { script: { language: "javascript", source: "" } } }],
    }),
    /language must be hara/,
  );
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

test("older audio-only drafts migrate to empty authoring collections", () => {
  const legacy = {
    format: draft.format,
    version: draft.version,
    revision: 1,
    audioSources: draft.audioSources,
  };
  const validated = validateWorldDraft(legacy);
  assert.deepEqual(validated.entities, []);
  assert.deepEqual(validated.collections, []);
  assert.deepEqual(validated.assets, []);
  assert.deepEqual(validated.prefabs, []);
  assert.equal(validated.animations[0].id, "main");
});
