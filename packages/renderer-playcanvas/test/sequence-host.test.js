import assert from "node:assert/strict";
import test from "node:test";
import {
  PLAYCANVAS_SEQUENCE_EXTERNAL_COMPLETION_OPERATIONS,
  PLAYCANVAS_SEQUENCE_OPERATIONS,
  PLAYCANVAS_SEQUENCE_PROVIDER_ID,
  PlayCanvasSequenceHost,
  PlayCanvasSequenceHostError,
  createPlayCanvasSequenceHost,
  createPlayCanvasSequenceOperationProfile,
} from "../src/sequence-host.js";

class FakeEntity {
  constructor(name, position = [0, 0, 0]) {
    this.name = name;
    this.position = { x: position[0], y: position[1], z: position[2] };
    this.rotation = { x: 0, y: 0, z: 0 };
    this.scale = { x: 1, y: 1, z: 1 };
    this.enabled = true;
    this.looks = [];
  }

  getPosition() {
    return { ...this.position };
  }

  setPosition(x, y, z) {
    this.position = { x, y, z };
  }

  setEulerAngles(x, y, z) {
    this.rotation = { x, y, z };
  }

  setLocalScale(x, y, z) {
    this.scale = { x, y, z };
  }

  lookAt(x, y, z) {
    this.looks.push([x, y, z]);
  }
}

function effect(id, operation, {
  sequenceId = "sequence/ballroom",
  cueId = id,
  target = null,
  action = {},
  at = 0,
  capabilities = [],
  preview = false,
} = {}) {
  return {
    type: "sequence/action",
    id,
    sequenceId,
    cueId,
    operation,
    target,
    action: { op: operation, ...action },
    at,
    capabilities,
    preview,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function position(entity) {
  return [entity.position.x, entity.position.y, entity.position.z];
}

test("declares the bounded PlayCanvas sequence operation profile", () => {
  assert.equal(PLAYCANVAS_SEQUENCE_PROVIDER_ID, "playcanvas");
  assert.deepEqual(PLAYCANVAS_SEQUENCE_OPERATIONS, [
    "character/place",
    "character/move-to",
    "character/turn-to",
    "character/play-clip",
    "character/blend-clip",
    "character/look-at",
    "character/gesture",
    "character/say",
    "camera/cut-to",
    "camera/blend-to",
    "audio/play",
    "world/emit",
  ]);
  assert.deepEqual(PLAYCANVAS_SEQUENCE_EXTERNAL_COMPLETION_OPERATIONS, [
    "character/place",
    "camera/cut-to",
    "world/emit",
  ]);
  const profile = createPlayCanvasSequenceOperationProfile({
    "character/place": { id: "character/place", completion: { mode: "immediate" } },
    "camera/cut-to": { id: "camera/cut-to", completion: { mode: "immediate" } },
    "world/emit": { id: "world/emit", completion: { mode: "immediate" } },
  });
  assert.deepEqual(profile["character/place"].completion, { mode: "external", marker: null });
  assert.deepEqual(profile["camera/cut-to"].completion, { mode: "external", marker: null });
  assert.deepEqual(profile["world/emit"].completion, { mode: "external", marker: null });
});

test("places actors immediately and suppresses duplicate effect identities", () => {
  const guest = new FakeEntity("guest");
  const events = [];
  const host = createPlayCanvasSequenceHost({
    emit: (event) => events.push(event),
    resolveEntity: () => guest,
    resolveMark: () => ({ position: [2, 0, 3], rotation: [0, 90, 0] }),
  });

  const input = effect("guest/place", "character/place", {
    target: { id: "guest", entityId: "guest-entity" },
    action: { mark: "entrance", scale: [1.2, 1.2, 1.2] },
  });
  const accepted = host.handle(input);
  assert.deepEqual(accepted, {
    accepted: true,
    duplicate: false,
    effectId: "guest/place",
    operation: "character/place",
    status: "completed",
  });
  assert.deepEqual(position(guest), [2, 0, 3]);
  assert.deepEqual([guest.rotation.x, guest.rotation.y, guest.rotation.z], [0, 90, 0]);
  assert.deepEqual([guest.scale.x, guest.scale.y, guest.scale.z], [1.2, 1.2, 1.2]);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "sequence/cue-complete");
  assert.equal(events[0].id, "guest/place/completed");

  const duplicate = host.handle(input);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(host.snapshot().actions, 1);
});

test("moves an actor over logical time and emits one stable arrival marker", () => {
  const guest = new FakeEntity("guest");
  const events = [];
  let clock = 0;
  const host = new PlayCanvasSequenceHost({
    emit: (event) => events.push(event),
    now: () => clock,
    resolveEntity: () => guest,
    resolveMark: () => ({ position: [3, 0, 0] }),
  });

  const accepted = host.handle(effect("guest/enter", "character/move-to", {
    target: { id: "guest", entityId: "guest" },
    action: { mark: "greeting", speed: 1.5 },
  }));
  assert.equal(accepted.status, "active");

  clock = 1;
  assert.deepEqual(host.tick(clock).completed, []);
  assert.deepEqual(position(guest), [1.5, 0, 0]);

  clock = 2;
  assert.deepEqual(host.tick(clock).completed, ["guest/enter"]);
  assert.deepEqual(position(guest), [3, 0, 0]);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    id: "guest/enter/marker/arrived",
    type: "sequence/marker",
    sequenceId: "sequence/ballroom",
    cueId: "guest/enter",
    marker: "arrived",
    at: 2,
    value: null,
    provider: { id: "playcanvas", version: "0.1.0" },
  });

  clock = 3;
  host.tick(clock);
  assert.equal(events.length, 1);
  assert.equal(host.snapshot().completed, 1);
});

test("uses injected navigation and suppresses promise completion after destruction", async () => {
  const guest = new FakeEntity("guest");
  const pending = deferred();
  const events = [];
  let signal;
  const host = createPlayCanvasSequenceHost({
    emit: (event) => events.push(event),
    resolveEntity: () => guest,
    navigation: {
      moveTo({ context }) {
        signal = context.signal;
        return {
          promise: pending.promise,
          cancel() {},
          dispose() {},
        };
      },
    },
  });

  host.handle(effect("guest/async-enter", "character/move-to", {
    target: { id: "guest" },
    action: { position: [5, 0, 0] },
  }));
  assert.equal(signal.aborted, false);
  host.destroy();
  assert.equal(signal.aborted, true);
  pending.resolve({ complete: true, marker: "arrived" });
  await flushPromises();
  assert.deepEqual(events, []);
  assert.equal(host.snapshot().cancelled, 1);
  assert.throws(
    () => host.handle(effect("after-destroy", "world/emit", { action: { event: "x" } })),
    (error) => error instanceof PlayCanvasSequenceHostError && error.code === "sequence/host-destroyed",
  );
});

test("plays and blends clips through the PlayCanvas animation fallback", () => {
  const guest = new FakeEntity("guest");
  const transitions = [];
  guest.anim = {
    baseLayer: {
      transition(clip, blend) {
        transitions.push([clip, blend]);
      },
    },
  };
  const events = [];
  const host = createPlayCanvasSequenceHost({
    emit: (event) => events.push(event),
    resolveEntity: () => guest,
    resolveClipDuration: (input) => input.action.clip === "wave" ? 1.25 : 2,
  });

  host.handle(effect("guest/wave", "character/play-clip", {
    target: { id: "guest" },
    action: { clip: "wave" },
  }));
  assert.deepEqual(transitions, [["wave", 0]]);
  host.tick(1.25);
  assert.equal(events.at(-1).marker, "clip-complete");

  host.handle(effect("guest/dance", "character/blend-clip", {
    target: { id: "guest" },
    action: { clip: "dance", blendIn: 0.35 },
    at: 2,
  }));
  assert.deepEqual(transitions.at(-1), ["dance", 0.35]);
  host.tick(4);
  assert.equal(events.at(-1).id, "guest/dance/marker/clip-complete");
});

test("turns and looks at actor or mark targets with semantic completion markers", () => {
  const hostEntity = new FakeEntity("host");
  const guest = new FakeEntity("guest", [4, 1, 2]);
  const events = [];
  const host = createPlayCanvasSequenceHost({
    emit: (event) => events.push(event),
    resolveEntity(reference) {
      const id = reference?.id ?? reference?.entityId ?? reference;
      return id === "host" ? hostEntity : id === "guest" ? guest : null;
    },
    resolveMark: (id) => id === "door" ? { position: [8, 0, 0] } : null,
  });

  host.handle(effect("host/look", "character/look-at", {
    target: { id: "host" },
    action: { target: "guest" },
  }));
  host.handle(effect("host/turn", "character/turn-to", {
    target: { id: "host" },
    action: { mark: "door" },
  }));

  assert.deepEqual(hostEntity.looks, [[4, 1, 2], [8, 0, 0]]);
  assert.deepEqual(events.map(({ marker }) => marker), ["look-complete", "turned"]);
});

test("routes dialogue and audio to injected capability drivers", async () => {
  const actor = new FakeEntity("host");
  const events = [];
  const spoken = [];
  const played = [];
  const host = createPlayCanvasSequenceHost({
    emit: (event) => events.push(event),
    now: () => 5,
    resolveEntity: () => actor,
    dialogue: {
      say({ effect }) {
        spoken.push(effect.action.line);
        return Promise.resolve({ complete: true, marker: "line-finished", value: { transcript: effect.action.line } });
      },
    },
    audio: {
      play({ effect }) {
        played.push(effect.action.audioId);
        return { complete: true, marker: "audio-finished" };
      },
    },
  });

  host.handle(effect("host/welcome", "character/say", {
    target: { id: "host" },
    action: { line: "Welcome." },
  }));
  host.handle(effect("music/start", "audio/play", {
    action: { audioId: "sha256:music" },
  }));
  await flushPromises();

  assert.deepEqual(spoken, ["Welcome."]);
  assert.deepEqual(played, ["sha256:music"]);
  assert.deepEqual(events.map(({ marker }) => marker), ["audio-finished", "line-finished"]);
  assert.deepEqual(events.at(-1).value, { transcript: "Welcome." });
});

test("cuts and blends cameras, restoring the source camera when cancelled", () => {
  const wide = new FakeEntity("wide", [0, 0, 0]);
  const close = new FakeEntity("close", [10, 0, 0]);
  close.enabled = false;
  const events = [];
  const cameras = { wide, close };
  const host = createPlayCanvasSequenceHost({
    emit: (event) => events.push(event),
    resolveCamera: (id) => cameras[id] ?? null,
    activeCamera: wide,
  });

  host.handle(effect("camera/blend-cancel", "camera/blend-to", {
    action: { camera: "close", duration: 2 },
  }));
  host.tick(1);
  assert.deepEqual(position(wide), [5, 0, 0]);
  assert.equal(host.cancel("camera/blend-cancel"), true);
  assert.deepEqual(position(wide), [0, 0, 0]);
  assert.equal(wide.enabled, true);
  assert.equal(close.enabled, false);
  assert.equal(host.activeCamera, wide);
  assert.deepEqual(events, []);

  host.handle(effect("camera/blend-complete", "camera/blend-to", {
    action: { camera: "close", duration: 1 },
    at: 2,
  }));
  host.tick(3);
  assert.equal(wide.enabled, false);
  assert.equal(close.enabled, true);
  assert.equal(host.activeCamera, close);
  assert.equal(events.at(-1).marker, "camera-complete");

  host.handle(effect("camera/cut-wide", "camera/cut-to", {
    action: { camera: "wide" },
    at: 4,
  }));
  assert.equal(wide.enabled, true);
  assert.equal(close.enabled, false);
  assert.equal(host.activeCamera, wide);
});

test("emits world events through the PlayCanvas application boundary", () => {
  const calls = [];
  const events = [];
  const host = createPlayCanvasSequenceHost({
    app: { fire: (...arguments_) => calls.push(arguments_) },
    emit: (event) => events.push(event),
  });
  const result = host.handle(effect("world/open-door", "world/emit", {
    action: { event: "door:open", payload: { id: "door-1" } },
  }));
  assert.equal(result.status, "completed");
  assert.deepEqual(calls, [["door:open", { id: "door-1" }]]);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "sequence/cue-complete");
  assert.equal(events[0].id, "world/open-door/completed");
});

test("returns structured failure events for missing capabilities and unsupported operations", () => {
  const actor = new FakeEntity("host");
  const events = [];
  const host = createPlayCanvasSequenceHost({
    emit: (event) => events.push(event),
    now: () => 2,
    resolveEntity: () => actor,
  });

  const failed = host.handle(effect("host/say", "character/say", {
    target: { id: "host" },
    action: { line: "Hello" },
  }));
  assert.equal(failed.accepted, true);
  assert.equal(failed.status, "failed");
  assert.equal(events[0].type, "sequence/cue-failed");
  assert.equal(events[0].code, "sequence/dialogue-capability");
  assert.equal(events[0].cueId, "host/say");

  const unsupported = host.handle(effect("physics/run", "physics/run"));
  assert.equal(unsupported.accepted, false);
  assert.equal(unsupported.status, "failed");
  assert.equal(events.at(-1).code, "sequence/operation-unsupported");
  const duplicate = host.handle(effect("physics/run", "physics/run"));
  assert.equal(duplicate.duplicate, true);
});

test("keeps action and event retention bounded", () => {
  const fired = [];
  const events = [];
  const host = createPlayCanvasSequenceHost({
    app: { fire: (...args) => fired.push(args) },
    emit: (event) => events.push(event),
    maximumActions: 1,
    maximumEvents: 2,
  });

  host.handle(effect("world/one", "world/emit", { action: { event: "one" } }));
  const rejected = host.handle(effect("world/two", "world/emit", { action: { event: "two" } }));
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.status, "failed");
  assert.equal(host.snapshot().actions, 1);
  assert.equal(host.snapshot().events, 2);
  assert.deepEqual(fired, [["one", null]]);
  assert.equal(events[0].type, "sequence/cue-complete");
  assert.equal(events[1].code, "sequence/action-capacity");

  const limited = createPlayCanvasSequenceHost({
    emit: (event) => events.push(event),
    resolveEntity: () => new FakeEntity("guest"),
    resolveMark: () => ({ position: [1, 0, 0] }),
    maximumEvents: 1,
  });
  limited.handle(effect("move/one", "character/move-to", {
    target: { id: "guest" },
    action: { mark: "one", duration: 0 },
  }));
  const failed = limited.handle(effect("say/without-driver", "character/say", {
    target: { id: "guest" },
    action: { line: "No driver" },
  }));
  assert.equal(failed.status, "failed");
  assert.equal(limited.snapshot().events, 1);
});

test("cancels and disposes active handlers exactly once", () => {
  let cancelled = 0;
  let disposed = 0;
  const host = createPlayCanvasSequenceHost({
    handlers: {
      "character/play-clip": () => ({
        cancel() { cancelled += 1; },
        dispose() { disposed += 1; },
      }),
    },
  });

  host.handle(effect("clip/active", "character/play-clip", {
    target: { id: "unused" },
    action: { clip: "idle" },
  }));
  assert.equal(host.cancel("clip/active"), true);
  assert.equal(host.cancel("clip/active"), false);
  host.destroy();
  assert.equal(cancelled, 1);
  assert.equal(disposed, 1);
});

test("deduplicates host-emitted marker identities and validates portable effects", () => {
  const events = [];
  const host = createPlayCanvasSequenceHost({
    emit: (event) => events.push(event),
    handlers: {
      "character/play-clip": (_effect, context) => {
        assert.equal(context.marker("beat", { frame: 12 }, 1), true);
        assert.equal(context.marker("beat", { frame: 13 }, 2), false);
        return {};
      },
    },
  });
  host.handle(effect("clip/marker", "character/play-clip", {
    target: { id: "unused" },
    action: { clip: "idle" },
  }));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].value, { frame: 12 });

  const sparse = [];
  sparse.length = 1;
  assert.throws(
    () => host.handle(effect("bad/sparse", "world/emit", { action: { event: "x", payload: sparse } })),
    /arrays cannot contain holes/i,
  );
});
