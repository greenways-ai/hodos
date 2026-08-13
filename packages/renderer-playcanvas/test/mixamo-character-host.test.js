import assert from "node:assert/strict";
import test from "node:test";
import {
  PLAYCANVAS_MIXAMO_CHARACTER_SCHEMA,
  PlayCanvasMixamoCharacterHost,
  createPlayCanvasMixamoCharacterHost,
  inspectPlayCanvasMixamoCharacter,
} from "../src/mixamo-character-host.js";

const parents = {
  Hips: null,
  Spine: "Hips",
  Spine1: "Spine",
  Spine2: "Spine1",
  Neck: "Spine2",
  Head: "Neck",
  LeftShoulder: "Spine2",
  LeftArm: "LeftShoulder",
  LeftForeArm: "LeftArm",
  LeftHand: "LeftForeArm",
  RightShoulder: "Spine2",
  RightArm: "RightShoulder",
  RightForeArm: "RightArm",
  RightHand: "RightForeArm",
  LeftUpLeg: "Hips",
  LeftLeg: "LeftUpLeg",
  LeftFoot: "LeftLeg",
  LeftToeBase: "LeftFoot",
  RightUpLeg: "Hips",
  RightLeg: "RightUpLeg",
  RightFoot: "RightLeg",
  RightToeBase: "RightFoot",
};

function entity(name, guid) {
  return {
    name,
    guid,
    children: [],
    getGuid() { return this.guid; },
    getChildren() { return this.children; },
  };
}

function character({ id = "hero", prefix = "mixamorig:", anim = true } = {}) {
  const calls = [];
  const root = entity(`${id}-root`, `${id}:root`);
  const armature = entity("Armature", `${id}:armature`);
  root.children.push(armature);
  const byName = new Map();
  for (const name of Object.keys(parents)) {
    byName.set(name, entity(`${prefix}${name}`, `${id}:${name}`));
  }
  for (const [name, parent] of Object.entries(parents)) {
    (parent ? byName.get(parent) : armature).children.push(byName.get(name));
  }
  if (anim) {
    root.anim = {
      speed: 1,
      baseLayer: {
        transition(state, blend) { calls.push(["transition", state, blend]); },
        pause() { calls.push(["pause"]); },
      },
      assignAnimation(state, track, layer, speed, loop) {
        calls.push(["assign", state, track.name, layer, speed, loop]);
      },
      removeNodeAnimations(state, layer) { calls.push(["remove", state, layer]); },
      rebind() { calls.push(["rebind"]); },
    };
  }
  return { root, calls, byName };
}

test("inspects a loaded PlayCanvas GLB hierarchy without retaining host objects", () => {
  const { root } = character();
  const profile = inspectPlayCanvasMixamoCharacter(root, {
    id: "hero/profile",
    assetId: "sha256:hero",
  });
  assert.equal(profile.status, "supported");
  assert.equal(profile.joints.hips.nodeId, "hero:Hips");
  assert.doesNotThrow(() => JSON.stringify(profile));
  assert.equal(JSON.stringify(profile).includes("getChildren"), false);
});

test("registers Mixamo characters and exposes sequence host integration", () => {
  const { root } = character();
  const host = createPlayCanvasMixamoCharacterHost({ id: "test" });
  const descriptor = host.register(root, {
    id: "hero",
    assetId: "sha256:hero",
    clips: {
      idle: { state: "Idle", duration: 2.5, loop: true },
      wave: { state: "Wave", duration: 1.2, loop: false },
    },
  });
  assert.equal(descriptor.schema, PLAYCANVAS_MIXAMO_CHARACTER_SCHEMA);
  assert.equal(descriptor.profile.status, "supported");
  assert.equal(descriptor.animation.playable, true);
  assert.deepEqual(descriptor.animation.clips.map(({ id }) => id), ["idle", "wave"]);
  assert.doesNotThrow(() => JSON.stringify(descriptor));

  const sequence = host.sequenceOptions();
  assert.equal(sequence.resolveEntity({ id: "hero" }), root);
  assert.equal(sequence.resolveClipDuration({
    type: "sequence/action",
    target: { characterId: "hero" },
    action: { op: "character/play-clip", clip: "wave" },
  }), 1.2);
  host.destroy();
});

test("assigns PlayCanvas AnimTracks and plays them through the modern anim component", () => {
  const { root, calls } = character();
  const host = new PlayCanvasMixamoCharacterHost({ id: "tracks" });
  host.register(root, { id: "hero" });
  const track = { name: "Mixamo Wave", duration: 1.75 };
  const clip = host.assignClip("hero", "wave", track, {
    state: "Wave",
    loop: false,
    speed: 1.25,
    layer: "base",
    resourceId: "sha256:wave",
  });
  assert.deepEqual(clip, {
    id: "wave",
    state: "Wave",
    duration: 1.75,
    loop: false,
    speed: 1.25,
    layer: "base",
    resourceId: "sha256:wave",
    assigned: true,
  });
  assert.deepEqual(calls[0], ["assign", "Wave", "Mixamo Wave", "base", 1.25, false]);
  assert.deepEqual(calls[1], ["rebind"]);

  const played = host.play("hero", "wave", { blend: 0.2, speed: 0.75 });
  assert.equal(played.duration, 1.75);
  assert.equal(root.anim.speed, 0.75);
  assert.deepEqual(calls[2], ["transition", "Wave", 0.2]);
  assert.equal(host.pause("hero"), true);
  assert.deepEqual(calls[3], ["pause"]);
  host.destroy();
  assert.deepEqual(calls.at(-1), ["remove", "Wave", "base"]);
});

test("builds portable same-family plans between prefixed and stripped Mixamo characters", () => {
  const source = character({ id: "source" });
  const target = character({ id: "target", prefix: "" });
  const host = createPlayCanvasMixamoCharacterHost({ id: "retarget" });
  host.register(source.root, { id: "source" });
  host.register(target.root, { id: "target" });
  const plan = host.createRetargetPlan("source", "target", {
    id: "plan/source-target",
    rootMotion: "apply",
  });
  assert.equal(plan.mode, "same-family");
  assert.equal(plan.translationPolicy, "hips-only");
  assert.equal(plan.pathMap["mixamorig:LeftArm"], "LeftArm");
  assert.doesNotThrow(() => JSON.stringify(plan));
  host.destroy();
});

test("rejects raw FBX and incomplete humanoid hierarchies before registration", () => {
  const { root } = character();
  const host = createPlayCanvasMixamoCharacterHost({ id: "reject" });
  assert.throws(() => host.register(root, {
    id: "fbx",
    mediaType: "application/vnd.autodesk.fbx",
  }), (error) => error.code === "mixamo/skeleton-unsupported"
    && error.details.errors.some(({ code }) => code === "mixamo/media-type"));

  const incomplete = entity("incomplete", "incomplete:root");
  incomplete.children.push(entity("mixamorig:Hips", "incomplete:Hips"));
  assert.throws(() => host.register(incomplete, { id: "incomplete" }), (error) =>
    error.code === "mixamo/skeleton-unsupported"
    && error.details.missingRequired.includes("head"));
  assert.equal(host.evidence().characters, 0);
  host.destroy();
});

test("enforces bounded ownership and deterministic release", () => {
  const first = character({ id: "first" });
  const second = character({ id: "second" });
  const host = createPlayCanvasMixamoCharacterHost({ id: "bounded", maximumCharacters: 1 });
  const registered = host.register(first.root, { id: "first", clips: ["idle"] });
  assert.equal(host.release(registered.handle), true);
  assert.equal(host.release(registered.handle), false);
  host.register(second.root, { id: "second", clips: ["idle"] });
  assert.throws(() => host.register(first.root, { id: "third" }), (error) => error.code === "mixamo/character-limit");
  host.destroy();
  assert.deepEqual(host.evidence(), {
    provider: { id: "playcanvas/mixamo", version: "0-alpha.1" },
    hostId: "bounded",
    characters: 0,
    maximumCharacters: 1,
    maximumNodes: 1024,
    destroyed: true,
  });
});
