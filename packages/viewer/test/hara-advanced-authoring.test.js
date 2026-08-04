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

async function kernel() {
  const runtime = await start({ resources });
  runtime.require("gw.hodos.kernel");
  return (method, args) => decode(runtime.eval(
    `(gw.hodos.kernel/dispatch ${encodeHalValue(method)} ${encodeHalValue(args)})`,
  ));
}

const world = {
  repository: { owner: "greenways-worlds", repo: "editor", url: "https://github.com/greenways-worlds/editor" },
  commit: "a".repeat(40),
  project: { id: "greenways-worlds/editor", version: "1.0.0" },
  touchpoints: [],
};

function entity(id, position, script = null) {
  return {
    id,
    name: id,
    kind: "box",
    parent: null,
    collection: "set",
    visible: true,
    locked: false,
    origin: [0, 0, 0],
    transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
    components: {
      primitive: { shape: "box", color: "#c8ad73", opacity: 1 },
      ...(script ? { script } : {}),
    },
  };
}

function authoringDocument() {
  return {
    entities: [
      entity("cube-a", [0, 0, 0], {
        language: "hara",
        enabled: true,
        events: ["world/entity-transform"],
        source: '(fn [event entity world] {"entity" entity "trace" event})',
      }),
      entity("cube-b", [2, 0, 0]),
    ],
    audioSources: [],
    collections: [{ id: "set", name: "Set", parent: null, visible: true, locked: false }],
    assets: [{ id: "chair", name: "Chair", kind: "gltf", url: "https://example.test/chair.glb", metadata: {} }],
    prefabs: [{
      id: "pair",
      name: "Pair",
      description: "",
      rootIds: ["cube-a"],
      entities: [entity("cube-a", [0, 0, 0])],
    }],
    animations: [{
      id: "main",
      name: "Main",
      duration: 4,
      fps: 30,
      tracks: [{
        id: "track-cube-a-position",
        entity: "cube-a",
        property: "position",
        enabled: true,
        keyframes: [
          { id: "start", time: 0, value: [0, 0, 0], easing: "linear" },
          { id: "end", time: 4, value: [4, 0, 0], easing: "linear" },
        ],
      }],
    }],
  };
}

test("Hara stores the complete authoring document and multi-selection", async () => {
  const dispatch = await kernel();
  dispatch("session/open", ["advanced-document", world]);
  const committed = dispatch("session/event", ["advanced-document", {
    "event/type": "world/document-commit",
    command: "seed-document",
    document: authoringDocument(),
  }]);
  assert.equal(committed.state.world.draft.entities.length, 2);
  assert.equal(committed.state.world.draft.collections[0].id, "set");
  assert.equal(committed.state.world.draft.assets[0].id, "chair");
  assert.equal(committed.state.world.draft.prefabs[0].id, "pair");
  assert.equal(committed.state.world.draft.animations[0].tracks.length, 1);
  assert.ok(committed.effects.some(({ effect, method }) => effect === "storage" && method === "save-world-draft"));
  assert.ok(committed.effects.some(({ effect, method }) => effect === "scene" && method === "sync-editor-document"));

  const selected = dispatch("session/event", ["advanced-document", {
    "event/type": "world/editor-select",
    targets: [
      { type: "entity", id: "cube-a" },
      { type: "entity", id: "cube-b" },
    ],
    mode: "replace",
  }]);
  assert.deepEqual(selected.state.world.editor.selection, [
    { type: "entity", id: "cube-a" },
    { type: "entity", id: "cube-b" },
  ]);
  assert.deepEqual(selected.state.world.editor.active, { type: "entity", id: "cube-b" });

  const toggled = dispatch("session/event", ["advanced-document", {
    "event/type": "world/editor-select",
    target: { type: "entity", id: "cube-a" },
    mode: "toggle",
  }]);
  assert.deepEqual(toggled.state.world.editor.selection, [{ type: "entity", id: "cube-b" }]);
});

test("one Hara transform transaction updates multiple objects and undoes together", async () => {
  const dispatch = await kernel();
  dispatch("session/open", ["advanced-transform", world]);
  dispatch("session/event", ["advanced-transform", {
    "event/type": "world/document-commit",
    document: authoringDocument(),
  }]);
  const transformed = dispatch("session/event", ["advanced-transform", {
    "event/type": "world/editor-transform-selection",
    items: [
      { type: "entity", id: "cube-a", transform: { position: [1, 0, 0], rotation: [0, 15, 0], scale: [1, 1, 1] } },
      { type: "entity", id: "cube-b", transform: { position: [3, 0, 0], rotation: [0, 15, 0], scale: [1, 1, 1] } },
    ],
  }]);
  assert.deepEqual(transformed.state.world.draft.entities.map((value) => value.transform.position), [[1, 0, 0], [3, 0, 0]]);
  const undone = dispatch("session/event", ["advanced-transform", { "event/type": "world/history-undo" }]);
  assert.deepEqual(undone.state.world.draft.entities.map((value) => value.transform.position), [[0, 0, 0], [2, 0, 0]]);
  const redone = dispatch("session/event", ["advanced-transform", { "event/type": "world/history-redo" }]);
  assert.deepEqual(redone.state.world.draft.entities.map((value) => value.transform.position), [[1, 0, 0], [3, 0, 0]]);
});

test("editor settings carry orientation, pivot, snapping, isolation and timeline", async () => {
  const dispatch = await kernel();
  dispatch("session/open", ["advanced-editor", world]);
  const updated = dispatch("session/event", ["advanced-editor", {
    "event/type": "world/editor-settings",
    patch: {
      tool: "box",
      space: "local",
      pivot: "cursor",
      cursor: [4, 1, -2],
      snap: { enabled: true, translate: 1, rotate: 15, scale: 0.25 },
      isolation: "set",
      timeline: { animation: "main", time: 1.5, playing: true, loop: true },
    },
  }]);
  assert.equal(updated.state.world.editor.tool, "box");
  assert.equal(updated.state.world.editor.space, "local");
  assert.equal(updated.state.world.editor.pivot, "cursor");
  assert.deepEqual(updated.state.world.editor.cursor, [4, 1, -2]);
  assert.equal(updated.state.world.editor.snap.rotate, 15);
  assert.equal(updated.state.world.editor.isolation, "set");
  assert.equal(updated.state.world.editor.timeline.time, 1.5);
});

test("Hara emits script requests and retains browser execution traces", async () => {
  const dispatch = await kernel();
  dispatch("session/open", ["advanced-script", world]);
  dispatch("session/event", ["advanced-script", {
    "event/type": "world/document-commit",
    document: authoringDocument(),
  }]);
  const requested = dispatch("session/event", ["advanced-script", {
    "event/type": "world/script-run",
    entity: "cube-a",
    trace: "trace-test",
    event: { "event/type": "world/editor-run" },
  }]);
  const scriptEffect = requested.effects.find(({ effect, method }) => effect === "script" && method === "evaluate");
  assert.equal(scriptEffect.args[0].trace, "trace-test");
  assert.match(scriptEffect.args[0].source, /^\(fn/);

  const completed = dispatch("session/event", ["advanced-script", {
    "event/type": "world/script-result",
    trace: "trace-test",
    entity: "cube-a",
    scriptEvent: { "event/type": "world/editor-run" },
    status: "completed",
    result: { trace: "ok" },
    at: "2026-08-04T00:00:00.000Z",
  }]);
  assert.equal(completed.state.world.scripting.traces.length, 1);
  assert.equal(completed.state.world.scripting.traces[0].result.trace, "ok");
});

test("repository publication contains collections, prefabs and animation tracks", async () => {
  const dispatch = await kernel();
  dispatch("session/open", ["advanced-publish", world]);
  dispatch("session/event", ["advanced-publish", {
    "event/type": "world/document-commit",
    document: authoringDocument(),
  }]);
  const published = dispatch("session/event", ["advanced-publish", {
    "event/type": "world/publish-repository",
  }]);
  const effect = published.effects.find(({ effect: service, method }) => service === "publication" && method === "repository-patch");
  assert.equal(effect.args[1].collections[0].id, "set");
  assert.equal(effect.args[1].prefabs[0].id, "pair");
  assert.equal(effect.args[1].animations[0].tracks[0].entity, "cube-a");
});
