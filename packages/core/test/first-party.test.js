import assert from "node:assert/strict";
import test from "node:test";
import { createHodosHost } from "../src/index.js";
import {
  hodosHaraDistribution,
  HODOS_HARA_RUNTIME_ADDON_ID,
} from "@greenways/hodos-runtime-hara";
import { HODOS_AUTHORING_ADDON_ID } from "@greenways/hodos-addon-authoring";

test("first-party semantic add-ons compose without loading a renderer or runtime", async () => {
  const host = createHodosHost({
    capabilities: ["workspace.drafts", "publication.intent", "workspace.authoring"],
  });
  host.register(hodosHaraDistribution);
  await host.activate(HODOS_AUTHORING_ADDON_ID);
  assert.deepEqual(host.active(), [
    "@greenways/hodos-core",
    "@greenways/hodos-addon-drafts",
    "@greenways/hodos-addon-publication",
    "@greenways/hodos-addon-authoring",
  ]);
  assert.deepEqual(
    host.listContributions("hara.module").map(({ id }) => id),
    [
      "gw.hodos.adaptor",
      "gw.hodos.bundle",
      "gw.hodos.package",
      "gw.hodos.scene",
      "gw.hodos.session",
      "gw.hodos.session-draft",
      "gw.hodos.session-publication",
      "gw.hodos.session-authoring",
    ],
  );
  const runtime = host.registered().find(({ id }) => id === HODOS_HARA_RUNTIME_ADDON_ID);
  assert.equal(runtime.capabilities[0], "runtime.hara");
});
