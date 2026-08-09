import assert from "node:assert/strict";
import test from "node:test";
import { TahtoWorldSource } from "../src/tahto-worlds.js";

const digest = `sha256:${"a".repeat(64)}`;

test("routes Hodos world reads through a fixed semantic coordinate", async () => {
  const calls = [];
  const source = new TahtoWorldSource({
    broker: {
      read: async (...args) => { calls.push(["read", ...args]); return { status: "ready", value: { id: "world.home" } }; },
      prepare: async () => {},
      submit: async () => {},
    },
  });
  assert.equal((await source.readWorld("world.home")).value.id, "world.home");
  assert.deepEqual(calls, [["read", {
    application: "greenways.hodos", namespace: "worlds", collection: "world",
  }, { stableId: "world.home" }]]);
});

test("keeps prepare and submit separate and requires a content-addressed plan", async () => {
  const calls = [];
  const broker = {
    read: async () => {},
    prepare: async (...args) => { calls.push(["prepare", ...args]); return { status: "prepared", planDigest: digest }; },
    submit: async (...args) => { calls.push(["submit", ...args]); return { status: "committed", root: digest }; },
  };
  const source = new TahtoWorldSource({ broker });
  const plan = await source.prepareWorld("world.home", { title: "Home" });
  const result = await source.submitWorld(plan);
  assert.equal(result.root, digest);
  assert.equal(calls[0][0], "prepare");
  assert.equal(calls[1][0], "submit");
  await assert.rejects(() => source.submitWorld({ status: "prepared" }), /plan digest/);
});

test("never accepts authority or executable material as world state", async () => {
  const source = new TahtoWorldSource({
    broker: { read: async () => ({}), prepare: async () => ({}), submit: async () => ({}) },
  });
  await assert.rejects(() => source.prepareWorld("world.home", { privateKey: "no" }), /forbidden field privateKey/);
  assert.throws(() => new TahtoWorldSource({ broker: null }), /capability broker/);
});
