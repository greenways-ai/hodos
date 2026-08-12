import assert from "node:assert/strict";
import test from "node:test";
import {
  CHARACTER_SCHEMA,
  createCharacterProfile,
  normalizeCharacterProfile,
  validateCharacterProfile,
} from "../src/character-model.js";
import {
  SEQUENCE_SCHEMA,
  SequenceValidationError,
  createSequence,
  normalizeSequence,
  normalizeSequenceOperationRegistry,
  validateSequence,
} from "../src/sequence-model.js";
import {
  applySequenceEvent,
  openSequence,
  seekSequence,
  tickSequence,
} from "../src/sequence-runtime.js";

function character(id) {
  return createCharacterProfile({
    id,
    assetId: `sha256:${id}`,
    rigId: `sha256:${id}-rig`,
    clips: {
      idle: { resourceId: `sha256:${id}-idle`, loop: true },
      walk: {
        resourceId: `sha256:${id}-walk`,
        rootMotion: "extract",
        markers: [{ id: "left-foot", at: 0.2 }, { id: "right-foot", at: 0.7 }],
      },
      wave: { resourceId: `sha256:${id}-wave`, layer: "upper-body" },
    },
    layers: [
      { id: "base", mode: "override" },
      { id: "upper-body", mode: "override", mask: "upper-body" },
    ],
    capabilities: ["speech", "locomotion", "speech"],
  });
}

function ballroomSequence() {
  return createSequence({
    id: "peacock-ballroom/arrival",
    version: 1,
    actors: {
      guest: { entityId: "character/guest", characterId: "sha256:guest" },
      host: { entityId: "character/host", characterId: "sha256:host" },
    },
    marks: {
      greeting: { position: [0, 0, 1], facing: [0, 180, 0] },
      exit: { position: [0, 0, 8], facing: [0, 0, 0] },
    },
    cues: [
      {
        id: "guest-enter",
        start: { at: 0 },
        target: "guest",
        action: { op: "character/move-to", mark: "greeting", locomotion: "walk" },
        complete: { mode: "marker", marker: "arrived" },
        timeout: 8,
      },
      {
        id: "host-turn",
        start: { after: "guest-enter" },
        target: "host",
        action: { op: "character/look-at", target: "guest" },
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
        action: {
          op: "character/say",
          line: "Welcome to the ballroom.",
          audioId: "sha256:welcome",
          gesture: "open-hand",
        },
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
        action: { op: "character/play-clip", clip: "dance" },
      },
      {
        id: "leave",
        start: { after: "response" },
        when: { variable: "guest-response", equals: "leave" },
        target: "guest",
        action: { op: "character/move-to", mark: "exit", locomotion: "walk" },
      },
    ],
  });
}

function event(id, type, values = {}) {
  return { id, type, ...values };
}

function marker(state, id, cueId, name, at) {
  return applySequenceEvent(state, event(id, "sequence/marker", { cueId, marker: name, at }));
}

test("character profiles normalize stable clips, layers, markers and capabilities", () => {
  const profile = character("guest");
  assert.equal(profile.schema, CHARACTER_SCHEMA);
  assert.deepEqual(profile.capabilities, ["locomotion", "speech"]);
  assert.deepEqual(profile.clips.walk.markers.map(({ id }) => id), ["left-foot", "right-foot"]);
  assert.equal(profile.clips.walk.rootMotion, "extract");
  assert.equal(validateCharacterProfile(profile).valid, true);

  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => normalizeCharacterProfile({ ...profile, metadata: cyclic }), /reference cycles/i);
  assert.equal(validateCharacterProfile({ ...profile, layers: [{ id: "base" }, { id: "base" }] }).valid, false);
});

test("sequence documents normalize actors, marks, cues and trusted operations", () => {
  const sequence = ballroomSequence();
  assert.equal(sequence.schema, SEQUENCE_SCHEMA);
  assert.equal(sequence.timebase.fps, 30);
  assert.deepEqual(Object.keys(sequence.actors), ["guest", "host"]);
  assert.deepEqual(sequence.marks.greeting.rotation, [0, 180, 0]);
  assert.equal(sequence.cues[0].complete.marker, "arrived");
  assert.equal(validateSequence(sequence).valid, true);

  const operations = normalizeSequenceOperationRegistry({
    "custom/check": {
      target: "none",
      completion: "immediate",
      previewSafe: true,
      reversible: true,
      capabilities: ["custom.check"],
    },
  });
  const custom = normalizeSequence({
    id: "custom",
    cues: [{ id: "check", action: { op: "custom/check" } }],
  }, { operations });
  assert.equal(custom.cues[0].action.op, "custom/check");
});

test("sequence validation rejects cycles, missing actors, unknown operations and non-portable values", () => {
  assert.throws(() => normalizeSequence({
    id: "cycle",
    cues: [
      { id: "a", start: { after: "b" }, action: { op: "world/emit" } },
      { id: "b", start: { after: "a" }, action: { op: "world/emit" } },
    ],
  }), SequenceValidationError);

  assert.equal(validateSequence({
    id: "missing-target",
    cues: [{ id: "walk", target: "ghost", action: { op: "character/move-to" } }],
  }).valid, false);

  assert.equal(validateSequence({
    id: "unknown-operation",
    cues: [{ id: "unknown", action: { op: "unknown/run" } }],
  }).valid, false);

  const sparse = [{ id: "valid", action: { op: "world/emit" } }];
  sparse.length = 2;
  assert.throws(() => normalizeSequence({ id: "sparse", cues: sparse }), /holes/i);
});

test("the two-character runtime advances serial, parallel, marker and branching cues deterministically", () => {
  const sequence = ballroomSequence();
  const opened = openSequence(sequence);
  assert.equal(opened.state.status, "running");
  assert.equal(opened.state.cues["guest-enter"].status, "active");
  assert.deepEqual(opened.effects.map(({ cueId }) => cueId), ["guest-enter"]);

  const entered = marker(opened.state, "event-1", "guest-enter", "arrived", 2.5);
  assert.equal(entered.state.cues["guest-enter"].status, "completed");
  assert.equal(entered.state.cues["host-turn"].status, "active");
  assert.equal(entered.state.cues["camera-greeting"].status, "active");
  assert.deepEqual(entered.effects.map(({ cueId }) => cueId), ["host-turn", "camera-greeting"]);

  const looked = marker(entered.state, "event-2", "host-turn", "look-complete", 3);
  assert.equal(looked.state.cues.welcome.status, "active");
  assert.deepEqual(looked.effects.map(({ cueId }) => cueId), ["welcome"]);

  const camera = marker(looked.state, "event-3", "camera-greeting", "camera-complete", 3.2);
  const welcomed = marker(camera.state, "event-4", "welcome", "line-finished", 4);
  assert.equal(welcomed.state.cues.response.status, "active");
  assert.deepEqual(welcomed.effects.map(({ cueId }) => cueId), ["response"]);

  const chosen = applySequenceEvent(welcomed.state, event("event-5", "sequence/choice", {
    cueId: "response",
    value: "dance",
    at: 4.1,
  }));
  assert.equal(chosen.state.variables["guest-response"], "dance");
  assert.equal(chosen.state.cues.dance.status, "active");
  assert.equal(chosen.state.cues.leave.status, "skipped");
  assert.deepEqual(chosen.effects.map(({ cueId }) => cueId), ["dance"]);

  const completed = marker(chosen.state, "event-6", "dance", "clip-complete", 8);
  assert.equal(completed.state.status, "completed");
  assert.equal(completed.events.at(-1).type, "sequence/completed");

  const replay = [
    (state) => marker(state, "event-1", "guest-enter", "arrived", 2.5),
    (state) => marker(state, "event-2", "host-turn", "look-complete", 3),
    (state) => marker(state, "event-3", "camera-greeting", "camera-complete", 3.2),
    (state) => marker(state, "event-4", "welcome", "line-finished", 4),
    (state) => applySequenceEvent(state, event("event-5", "sequence/choice", { cueId: "response", value: "dance", at: 4.1 })),
    (state) => marker(state, "event-6", "dance", "clip-complete", 8),
  ].reduce((result, step) => step(result.state), openSequence(sequence));
  assert.deepEqual(replay.state, completed.state);
});

test("event identities are idempotent and inactive cue events fail closed", () => {
  const opened = openSequence(ballroomSequence());
  const once = marker(opened.state, "event-1", "guest-enter", "arrived", 2);
  const duplicate = marker(once.state, "event-1", "guest-enter", "arrived", 2);
  assert.deepEqual(duplicate.state, once.state);
  assert.deepEqual(duplicate.effects, []);
  assert.deepEqual(duplicate.events, []);

  const inactive = marker(opened.state, "early", "welcome", "line-finished", 1);
  assert.equal(inactive.state.cues.welcome.status, "pending");
  assert.equal(inactive.events[0].type, "sequence/event-ignored");
});

test("logical-time timeout policy fails and cancels the remaining sequence deterministically", () => {
  const opened = openSequence(ballroomSequence());
  const timedOut = tickSequence(opened.state, 8);
  assert.equal(timedOut.state.status, "failed");
  assert.match(timedOut.state.error, /guest-enter timed out/);
  assert.equal(timedOut.state.cues["guest-enter"].status, "failed");
  assert.equal(timedOut.state.cues["host-turn"].status, "cancelled");
});

test("bounded traces retain the newest records and declare truncation", () => {
  const opened = openSequence(ballroomSequence(), {}, { maxTrace: 4 });
  const entered = marker(opened.state, "event-1", "guest-enter", "arrived", 2);
  const looked = marker(entered.state, "event-2", "host-turn", "look-complete", 3);
  assert.equal(looked.state.trace.length, 4);
  assert.equal(looked.state.traceTruncated, true);
  assert.ok(looked.state.trace[0].sequence > 1);
});

test("seek rejects cues whose operations are not reversible preview actions", () => {
  assert.throws(() => seekSequence(ballroomSequence(), 2), /cannot be replayed safely/i);
});
