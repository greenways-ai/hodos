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
  "gw.hodos.session-authoring": fs.readFileSync(new URL("../../kernel/src/gw/hodos/session_authoring.hal", import.meta.url), "utf8"),
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
  commit: "e".repeat(40),
  project: { id: "greenways-worlds/editor", version: "1.0.0", capabilities: [] },
  layers: [{ id: "base-room" }],
  touchpoints: [],
};

const cube = {
  id: "cube-1",
  name: "Cube",
  kind: "box",
  parent: null,
  collection: null,
  visible: true,
  locked: false,
  origin: [0, 0, 0],
  transform: { position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  components: { primitive: { shape: "box", color: "#c8ad73", opacity: 1 } },
};

test("Hara creates, selects and transforms generic world entities", async () => {
  const dispatch = await kernel();
  dispatch("session/open", ["editor-session", world]);
  const created = dispatch("session/event", ["editor-session", {
    "event/type": "world/entity-create",
    entity: cube,
  }]);
  assert.equal(created.state.world.draft.entities.length, 1);
  assert.deepEqual(created.state.world.editor.active, { type: "entity", id: "cube-1" });
  const effects = created.effects.map(({ effect, method }) => `${effect}/${method}`);
  assert.ok(effects.includes("scene/sync-world-entities"));
  assert.ok(effects.includes("scene/sync-editor-document"));
  assert.ok(effects.includes("storage/save-world-draft"));
  const storage = created.effects.find(({ effect, method }) => effect === "storage" && method === "save-world-draft");
  assert.equal(storage.args[1].entities[0].id, "cube-1");

  const transformed = dispatch("session/event", ["editor-session", {
    "event/type": "world/entity-transform",
    entity: "cube-1",
    transform: { position: [2, 1, -3], rotation: [0, 45, 0], scale: [2, 1, 1] },
  }]);
  assert.deepEqual(transformed.state.world.entities[0].transform.position, [2, 1, -3]);
  assert.equal(transformed.state.world.draft.history.undo.length, 2);

  const tool = dispatch("session/event", ["editor-session", {
    "event/type": "world/editor-tool", tool: "rotate",
  }]);
  assert.equal(tool.state.world.editor.tool, "rotate");
  assert.ok(tool.effects.some(({ effect, method }) => effect === "scene" && method === "sync-editor-document"));
});

test("Hara duplicates, parents, deletes and undoes scene objects", async () => {
  const dispatch = await kernel();
  dispatch("session/open", ["hierarchy-session", world]);
  dispatch("session/event", ["hierarchy-session", { "event/type": "world/entity-create", entity: cube }]);
  const child = {
    ...cube,
    id: "cube-2",
    name: "Child",
    parent: "cube-1",
    transform: { ...cube.transform, position: [1, 0, 0] },
  };
  dispatch("session/event", ["hierarchy-session", {
    "event/type": "world/entity-duplicate",
    source: "cube-1",
    entity: child,
  }]);
  let state = dispatch("session/get", ["hierarchy-session"]).state;
  assert.equal(state.world.entities[1].parent, "cube-1");
  assert.deepEqual(state.world.editor.active, { type: "entity", id: "cube-2" });

  dispatch("session/event", ["hierarchy-session", {
    "event/type": "world/entity-delete",
    entity: "cube-1",
  }]);
  state = dispatch("session/get", ["hierarchy-session"]).state;
  assert.deepEqual(state.world.entities.map(({ id, parent }) => [id, parent]), [["cube-2", null]]);
  assert.equal(state.world.editor.active, null);

  dispatch("session/event", ["hierarchy-session", { "event/type": "world/history-undo" }]);
  state = dispatch("session/get", ["hierarchy-session"]).state;
  assert.deepEqual(state.world.entities.map(({ id, parent }) => [id, parent]), [
    ["cube-1", null],
    ["cube-2", "cube-1"],
  ]);
});

test("Hara rejects duplicate ids, missing parents and locked transforms", async () => {
  const dispatch = await kernel();
  dispatch("session/open", ["validation-session", world]);
  dispatch("session/event", ["validation-session", { "event/type": "world/entity-create", entity: cube }]);
  assert.throws(() => dispatch("session/event", ["validation-session", {
    "event/type": "world/entity-create", entity: cube,
  }]), /already exists/);
  assert.throws(() => dispatch("session/event", ["validation-session", {
    "event/type": "world/entity-create",
    entity: { ...cube, id: "child", parent: "missing" },
  }]), /parent does not exist/);
  dispatch("session/event", ["validation-session", {
    "event/type": "world/entity-update",
    entity: { ...cube, locked: true },
  }]);
  dispatch("session/event", ["validation-session", {
    "event/type": "world/entity-transform",
    entity: "cube-1",
    transform: { position: [9, 9, 9], rotation: [0, 0, 0], scale: [1, 1, 1] },
  }]);
  const state = dispatch("session/get", ["validation-session"]).state;
  assert.deepEqual(state.world.entities[0].transform.position, [0, 0.5, 0]);
});
