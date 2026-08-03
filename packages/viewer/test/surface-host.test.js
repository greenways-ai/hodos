import assert from "node:assert/strict";
import test from "node:test";
import { SurfaceRegistry } from "../src/surface-host.js";

test("surface registry only creates explicitly installed classical interfaces", () => {
  const factory = (context) => ({ context });
  const registry = new SurfaceRegistry({ "hodos/studio": factory });
  assert.deepEqual(registry.ids(), ["hodos/studio"]);
  assert.equal(registry.has("hodos/studio"), true);
  assert.equal(registry.create("hodos/studio", { project: "local/current" }).context.project, "local/current");
  assert.throws(() => registry.create("world/arbitrary-html", {}), /not installed/);
});

test("surface ids and duplicate registrations are rejected", () => {
  const registry = new SurfaceRegistry();
  registry.register("hodos/studio", () => ({}));
  assert.throws(() => registry.register("hodos/studio", () => ({})), /already registered/);
  assert.throws(() => registry.register("bad surface", () => ({})), /invalid/);
});
