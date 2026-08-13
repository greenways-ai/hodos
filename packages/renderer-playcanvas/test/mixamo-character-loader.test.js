import assert from "node:assert/strict";
import test from "node:test";
import {
  PlayCanvasMixamoCharacterHost,
  createPlayCanvasMixamoCharacterHost,
} from "../src/mixamo-character-loader.js";

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
  RightUpLeg: "Hips",
  RightLeg: "RightUpLeg",
  RightFoot: "RightLeg",
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

function animationComponent(calls) {
  return {
    speed: 1,
    playing: false,
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

function character({ id = "hero", supported = true } = {}) {
  const calls = [];
  const root = entity(`${id}-root`, `${id}:root`);
  if (supported) {
    const armature = entity("Armature", `${id}:armature`);
    root.children.push(armature);
    const byName = new Map();
    for (const name of Object.keys(parents)) {
      byName.set(name, entity(`mixamorig:${name}`, `${id}:${name}`));
    }
    for (const [name, parent] of Object.entries(parents)) {
      (parent ? byName.get(parent) : armature).children.push(byName.get(name));
    }
  }
  root.addComponent = function addComponent(type, options) {
    calls.push(["add-component", type, options.activate, options.speed]);
    if (type === "anim") this.anim = animationComponent(calls);
  };
  root.destroy = () => calls.push(["destroy"]);
  return { root, calls };
}

function containerFixture({
  id = "hero",
  animationNames = ["Idle", "Wave.Hand"],
  supported = true,
} = {}) {
  const model = character({ id, supported });
  const animations = animationNames.map((name, index) => ({
    id: 100 + index,
    name: `${id}/animation/${index}`,
    resource: { name, duration: 1 + index * 0.5 },
  }));
  const registryCalls = [];
  const asset = {
    id: 42,
    name: `${id}.glb`,
    type: "container",
    loaded: true,
    resource: {
      animations,
      instantiateRenderEntity(options) {
        model.calls.push(["instantiate", options.castShadows ?? null]);
        return model.root;
      },
    },
    unload() { registryCalls.push(["unload", this.id]); },
  };
  const app = {
    root: {
      addChild(root) { registryCalls.push(["attach", root.name]); },
    },
    assets: {
      loadFromUrlAndFilename(url, fileName, type, callback) {
        registryCalls.push(["load", url, fileName, type]);
        queueMicrotask(() => callback(null, asset));
      },
      remove(removed) { registryCalls.push(["remove", removed.id]); },
    },
  };
  return { ...model, animations, asset, app, registryCalls };
}

test("loads a remote GLB, instantiates it, assigns embedded clips, and autoplays", async () => {
  const fixture = containerFixture();
  const host = createPlayCanvasMixamoCharacterHost({ app: fixture.app, id: "remote" });
  const descriptor = await host.load("https://cdn.example/characters/hero.glb?token=secret", {
    id: "hero",
    assetId: "sha256:hero",
    renderOptions: { castShadows: true },
    autoplay: true,
  });

  assert.deepEqual(fixture.registryCalls.slice(0, 2), [
    ["load", "https://cdn.example/characters/hero.glb?token=secret", "hero.glb", "container"],
    ["attach", "hero-root"],
  ]);
  assert.deepEqual(fixture.calls.slice(0, 4), [
    ["instantiate", true],
    ["add-component", "anim", false, 1],
    ["assign", "idle", "Idle", null, 1, true],
    ["rebind"],
  ]);
  assert.deepEqual(descriptor.source, {
    kind: "url",
    fileName: "hero.glb",
    mediaType: "model/gltf-binary",
    url: "https://cdn.example/characters/hero.glb",
    playcanvasAssetId: "42",
  });
  assert.deepEqual(descriptor.animation.clips.map(({ id, assigned }) => ({ id, assigned })), [
    { id: "idle", assigned: true },
    { id: "wave-hand", assigned: true },
  ]);
  assert.equal(fixture.root.anim.playing, true);
  assert.deepEqual(fixture.calls.at(-1), ["transition", "idle", 0]);

  assert.equal(host.release("hero"), true);
  assert.deepEqual(fixture.registryCalls.slice(-2), [
    ["unload", 42],
    ["remove", 42],
  ]);
  assert.deepEqual(fixture.calls.at(-1), ["destroy"]);
});

test("loads local GLB bytes through a revocable object URL", async () => {
  const fixture = containerFixture({ id: "local", animationNames: ["Walk Cycle"] });
  const revoked = [];
  const host = createPlayCanvasMixamoCharacterHost({
    app: fixture.app,
    id: "local-host",
    createObjectURL: () => "blob:hodos-mixamo",
    revokeObjectURL: (url) => revoked.push(url),
  });
  const descriptor = await host.load(new Uint8Array([0x67, 0x6c, 0x54, 0x46]), {
    id: "local",
    fileName: "local.glb",
  });
  assert.deepEqual(fixture.registryCalls[0], [
    "load",
    "blob:hodos-mixamo",
    "local.glb",
    "container",
  ]);
  assert.deepEqual(revoked, ["blob:hodos-mixamo"]);
  assert.equal(descriptor.source.kind, "local");
  assert.equal(descriptor.source.url, null);
  assert.equal(descriptor.animation.clips[0].id, "walk-cycle");
  host.destroy();
});

test("creates an AnimComponent for animationless GLBs so external tracks can be attached", async () => {
  const fixture = containerFixture({ id: "tpose", animationNames: [] });
  const host = new PlayCanvasMixamoCharacterHost({ app: fixture.app, id: "tpose-host" });
  const descriptor = await host.load("https://cdn.example/tpose.glb", { id: "tpose" });
  assert.equal(descriptor.animation.component, "anim");
  assert.equal(descriptor.animation.playable, true);

  host.assignClip("tpose", "walk", { name: "Walk", duration: 0.9 });
  host.play("tpose", "walk");
  assert.equal(fixture.root.anim.playing, true);
  host.destroy();
});

test("does not unload caller-owned PlayCanvas container assets", async () => {
  const fixture = containerFixture({ id: "managed" });
  const host = createPlayCanvasMixamoCharacterHost({ app: fixture.app, id: "managed-host" });
  const descriptor = await host.load(fixture.asset, { id: "managed" });
  assert.equal(descriptor.source.kind, "asset");
  host.destroy();
  assert.equal(fixture.registryCalls.some(([operation]) => operation === "unload"), false);
  assert.equal(fixture.registryCalls.some(([operation]) => operation === "remove"), false);
  assert.deepEqual(fixture.calls.at(-1), ["destroy"]);
});

test("rolls back instantiated entities and owned assets when the skeleton is unsupported", async () => {
  const fixture = containerFixture({ id: "bad", supported: false, animationNames: [] });
  const host = createPlayCanvasMixamoCharacterHost({ app: fixture.app, id: "rollback" });
  await assert.rejects(
    host.load("https://cdn.example/bad.glb", { id: "bad" }),
    (error) => error.code === "mixamo/skeleton-unsupported",
  );
  assert.deepEqual(fixture.calls, [["instantiate", null], ["destroy"]]);
  assert.deepEqual(fixture.registryCalls.slice(-2), [
    ["unload", 42],
    ["remove", 42],
  ]);
  assert.equal(host.evidence().characters, 0);
});

test("rejects raw FBX and oversized local sources before PlayCanvas loading", async () => {
  let loads = 0;
  const app = {
    root: {},
    assets: {
      loadFromUrlAndFilename() { loads += 1; },
    },
  };
  const host = createPlayCanvasMixamoCharacterHost({
    app,
    id: "source-validation",
    maximumSourceBytes: 3,
    createObjectURL: () => "blob:unused",
    revokeObjectURL: () => {},
  });
  await assert.rejects(
    host.load("https://cdn.example/hero.fbx", { id: "fbx" }),
    (error) => error.code === "mixamo/media-type",
  );
  await assert.rejects(
    host.load(new Uint8Array(4), { id: "large", fileName: "large.glb" }),
    (error) => error.code === "mixamo/source-limit",
  );
  assert.equal(loads, 0);
  host.destroy();
});
