import assert from "node:assert/strict";
import test from "node:test";
import { createHodosHost, hodosCoreAddon } from "../src/index.js";
import {
  hodosPlayCanvasRendererAddon,
  HODOS_PLAYCANVAS_RENDERER_ADDON_ID,
} from "@greenways/hodos-renderer-playcanvas";
import {
  hodosGithubSourceAddon,
  HODOS_GITHUB_SOURCE_ADDON_ID,
} from "@greenways/hodos-source-github";
import { hodosWorldAuthoringUiAddon } from "@greenways/hodos-ui-world-authoring";
import { hodosWorldPublicationUiAddon } from "@greenways/hodos-ui-world-publication";
import { hodosWorldModelAddon } from "@greenways/hodos-world-model";

test("source and renderer add-ons compose without creating a browser viewer", async () => {
  const host = createHodosHost({
    capabilities: ["character.animation", "network.github", "sequence.execute", "world.render"],
  });
  host.register(
    hodosCoreAddon,
    hodosWorldModelAddon,
    hodosGithubSourceAddon,
    hodosPlayCanvasRendererAddon,
  );
  await host.activate([HODOS_GITHUB_SOURCE_ADDON_ID, HODOS_PLAYCANVAS_RENDERER_ADDON_ID]);
  const source = host.getContribution("world.source", "github");
  assert.equal(source.Client.name, "PublicGitHubClient");
  assert.deepEqual(source.effect, { effect: "github", method: "resolve-world" });
  assert.equal(host.getContribution("world.renderer", "playcanvas").Renderer.name, "WorldRenderer");
  assert.deepEqual(host.active(), [
    "@greenways/hodos-core",
    "@greenways/hodos-source-github",
    "@greenways/hodos-world-model",
    "@greenways/hodos-renderer-playcanvas",
  ]);
});

test("optional world UIs declare their own authority", () => {
  assert.deepEqual(hodosWorldAuthoringUiAddon.manifest.capabilities, [
    "workspace.authoring",
    "workspace.drafts",
  ]);
  assert.deepEqual(hodosWorldPublicationUiAddon.manifest.capabilities, [
    "publication.intent",
    "workspace.drafts",
  ]);
  assert.equal(
    hodosWorldAuthoringUiAddon.manifest.requires[HODOS_PLAYCANVAS_RENDERER_ADDON_ID],
    "^0.1.0",
  );
});
