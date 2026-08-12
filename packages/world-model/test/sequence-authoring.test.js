import assert from "node:assert/strict";
import test from "node:test";
import { createCharacterProfile } from "../src/character-model.js";
import { createSequence } from "../src/sequence-model.js";
import {
  applySequenceAuthoringCommand,
  applySequenceAuthoringPreviewEvent,
  canonicalSequenceJson,
  diagnoseSequenceBindings,
  openSequenceAuthoring,
  openSequenceAuthoringPreview,
  parseCanonicalSequenceJson,
  projectSequenceTimeline,
  seekSequenceAuthoringPreview,
  sequenceAuthoringSnapshot,
} from "../src/sequence-authoring.js";

function characters() {
  return {
    guest: createCharacterProfile({
      id: "guest",
      assetId: "sha256:guest",
      rigId: "sha256:guest-rig",
      clips: {
        walk: { resourceId: "sha256:guest-walk" },
        dance: { resourceId: "sha256:guest-dance" },
      },
      capabilities: ["character.navigation", "character.animation"],
    }),
    host: createCharacterProfile({
      id: "host",
      assetId: "sha256:host",
      rigId: "sha256:host-rig",
      clips: { idle: { resourceId: "sha256:host-idle" } },
      capabilities: ["character.look-at", "character.dialogue", "audio.play"],
    }),
  };
}

function ballroom() {
  return createSequence({
    id: "peacock-ballroom/arrival",
    name: "Peacock ballroom arrival",
    actors: {
      guest: { entityId: "character/guest", characterId: "guest" },
      host: { entityId: "character/host", characterId: "host" },
    },
    marks: {
      greeting: { position: [0, 0, 1] },
      dancefloor: { position: [2, 0, 4] },
    },
    cues: [
      {
        id: "guest-enter",
        start: { at: 0 },
        target: "guest",
        action: { op: "character/move-to", mark: "greeting", locomotion: "walk", duration: 2 },
        timeout: 8,
      },
      {
        id: "host-turn",
        start: { after: "guest-enter" },
        target: "host",
        action: { op: "character/look-at", target: "guest", duration: 0.5 },
      },
      {
        id: "camera-greeting",
        start: { with: "host-turn" },
        action: { op: "camera/blend-to", camera: "camera/two-shot", duration: 0.8 },
      },
      {
        id: "welcome",
        start: { after: "host-turn" },
        target: "host",
        action: { op: "character/say", line: "Welcome to the ballroom." },
      },
      {
        id: "response",
        start: { after: "welcome" },
        action: { op: "sequence/choose", variable: "guest-response", cases: ["dance", "leave"] },
      },
      {
        id: "dance",
        start: { after: "response" },
        when: { variable: "guest-response", equals: "dance" },
        target: "guest",
        action: { op: "character/play-clip", clip: "dance", duration: 4 },
      },
    ],
  });
}

test("sequence authoring edits cues, grouping, ordering and scene marks through bounded history", () => {
  const initial = openSequenceAuthoring(ballroom(), { characters: characters(), maxHistory: 4 });
  const inserted = applySequenceAuthoringCommand(initial, {
    type: "sequence/cue-insert",
    label: "Add ballroom reveal",
    afterCueId: "camera-greeting",
    cue: {
      id: "ballroom-reveal",
      start: { with: "camera-greeting" },
      action: { op: "world/emit", event: "ballroom/reveal" },
      metadata: { duration: 1 },
    },
  });
  assert.equal(inserted.sequence.cues[3].id, "ballroom-reveal");

  const grouped = applySequenceAuthoringCommand(inserted, {
    type: "sequence/cue-group",
    groupId: "greeting-beat",
    cueIds: ["host-turn", "camera-greeting", "ballroom-reveal"],
  });
  assert.equal(grouped.sequence.cues.find(({ id }) => id === "host-turn").metadata.group, "greeting-beat");

  const marked = applySequenceAuthoringCommand(grouped, {
    type: "sequence/mark-upsert",
    markId: "balcony",
    mark: { position: [4, 2, 8], rotation: [0, 180, 0] },
  });
  assert.deepEqual(marked.sequence.marks.balcony.position, [4, 2, 8]);

  const reorderedIds = ["guest-enter", "host-turn", "camera-greeting", "ballroom-reveal", "welcome", "response", "dance"];
  const reordered = applySequenceAuthoringCommand(marked, {
    type: "sequence/cue-reorder",
    cueIds: reorderedIds,
  });
  assert.deepEqual(reordered.sequence.cues.map(({ id }) => id), reorderedIds);

  const undone = applySequenceAuthoringCommand(reordered, { type: "history/undo" });
  assert.deepEqual(undone.sequence, marked.sequence);
  const redone = applySequenceAuthoringCommand(undone, { type: "history/redo" });
  assert.deepEqual(redone.sequence, reordered.sequence);
  assert.equal(redone.past.length <= 4, true);
});

test("dependent cue and actor deletion fail closed unless cascade is explicit", () => {
  const initial = openSequenceAuthoring(ballroom(), { characters: characters() });
  assert.throws(() => applySequenceAuthoringCommand(initial, {
    type: "sequence/cue-delete",
    cueId: "guest-enter",
  }), /required by cues/i);
  assert.throws(() => applySequenceAuthoringCommand(initial, {
    type: "sequence/actor-delete",
    actorId: "guest",
  }), /targeted by cues/i);

  const deleted = applySequenceAuthoringCommand(initial, {
    type: "sequence/cue-delete",
    cueId: "guest-enter",
    cascade: true,
  });
  assert.deepEqual(deleted.sequence.cues, []);
});

test("timeline projection creates reusable character, camera, dialogue and sequence lanes", () => {
  const tracks = projectSequenceTimeline(ballroom());
  assert.deepEqual(tracks.map(({ id }) => id), [
    "character:guest",
    "character:host",
    "camera",
    "dialogue:host",
    "sequence",
  ]);
  const camera = tracks.find(({ id }) => id === "camera").cues[0];
  const turn = tracks.find(({ id }) => id === "character:host").cues[0];
  assert.equal(camera.start, turn.start);
  assert.equal(camera.startCondition.type, "with");
  assert.equal(tracks.find(({ id }) => id === "character:guest").cues[1].branch.variable, "guest-response");
});

test("binding diagnostics report missing clips while canonical serialization round-trips", () => {
  const sequence = ballroom();
  const valid = diagnoseSequenceBindings(sequence, { characters: characters() });
  assert.equal(valid.valid, true);

  const broken = {
    ...sequence,
    cues: sequence.cues.map((cue) => cue.id === "dance"
      ? { ...cue, action: { ...cue.action, clip: "missing-dance" } }
      : cue),
  };
  const diagnostics = diagnoseSequenceBindings(broken, { characters: characters() });
  assert.equal(diagnostics.valid, false);
  assert.equal(diagnostics.errors[0].code, "cue/missing-clip");

  const source = canonicalSequenceJson(sequence, { characters: characters() });
  assert.deepEqual(parseCanonicalSequenceJson(source), sequence);
  assert.equal(source, canonicalSequenceJson(parseCanonicalSequenceJson(source)));
});

test("authoring preview emits structured effects and reconstructs deterministic seek state", () => {
  const authoring = openSequenceAuthoring(ballroom(), { characters: characters() });
  const opened = openSequenceAuthoringPreview(authoring);
  assert.equal(opened.effects[0].type, "sequence/action");
  assert.equal(opened.effects[0].cueId, "guest-enter");
  assert.equal(opened.effects[0].preview, true);

  const first = seekSequenceAuthoringPreview(authoring, 3);
  const second = seekSequenceAuthoringPreview(authoring, 3);
  assert.deepEqual(first, second);

  const entered = applySequenceAuthoringPreviewEvent(opened.state, {
    id: "entered",
    type: "sequence/marker",
    cueId: "guest-enter",
    marker: "arrived",
    at: 2,
  });
  assert.deepEqual(entered.effects.map(({ cueId }) => cueId), ["host-turn", "camera-greeting"]);

  const snapshot = sequenceAuthoringSnapshot(authoring);
  assert.equal(snapshot.canUndo, false);
  assert.equal(snapshot.tracks.length, 5);
  assert.match(snapshot.canonicalJson, /peacock-ballroom\/arrival/);
});
