import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { start } from "../../kernel/runtime/hara-vm.mjs";
import { encodeHalValue } from "../../kernel/runtime/hal-transport.js";

const resources = {
  "gw.hodos.adaptor": fs.readFileSync(new URL("../../kernel/src/gw/hodos/adaptor.hal", import.meta.url), "utf8"),
  "gw.hodos.bundle": fs.readFileSync(new URL("../../kernel/src/gw/hodos/bundle.hal", import.meta.url), "utf8"),
  "gw.hodos.package": fs.readFileSync(new URL("../../kernel/src/gw/hodos/package.hal", import.meta.url), "utf8"),
  "gw.hodos.scene": fs.readFileSync(new URL("../../kernel/src/gw/hodos/scene.hal", import.meta.url), "utf8"),
  "gw.hodos.kernel": fs.readFileSync(new URL("../../kernel/src/gw/hodos/kernel.hal", import.meta.url), "utf8"),
};

test("browser VM exposes the HAL kernel through its generated adaptor surface", async () => {
  const runtime = await start({ resources });
  runtime.require("gw.hodos.kernel");
  assert.equal(
    runtime.eval('(get (get gw.hodos.kernel/SURFACE "world/open") "action")'),
    '"@hodos/world/open"',
  );
  assert.equal(
    runtime.eval('(gw.hodos.kernel/dispatch "catalog/search" [[{"name" "apartment"} {"name" "splat-garden"}] "garden"])'),
    '[{"name" "splat-garden"}]',
  );
});

test("host objects are encoded as EDN maps for HAL dispatch", async () => {
  const runtime = await start({ resources });
  runtime.require("gw.hodos.kernel");
  const graph = {
    repository: { owner: "greenways-worlds", repo: "playbot", url: "https://github.com/greenways-worlds/playbot" },
    layers: [{ id: "playbot", assetUrl: "https://raw.githubusercontent.com/greenways-worlds/playbot/commit/world/playbot/lod-meta.json" }],
    diagnostics: []
  };
  const source = `(gw.hodos.kernel/dispatch "world/render" ${encodeHalValue([graph])})`;
  const result = runtime.eval(source);
  assert.match(result, /"scene"/);
  assert.match(result, /"render-world"/);
});

test("HAL transport rejects invalid and circular host values with their path", () => {
  assert.throws(() => encodeHalValue({ graph: { scale: Number.NaN } }), /\.graph\.scale must be a finite number/);
  const value = { graph: {} };
  value.graph.parent = value;
  assert.throws(() => encodeHalValue(value), /\.graph\.parent contains a circular reference/);
});
