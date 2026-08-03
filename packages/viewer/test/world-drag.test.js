import assert from "node:assert/strict";
import test from "node:test";
import {
  HODOS_WORLD_DRAG_TYPE,
  hasHodosWorldDrag,
  readHodosWorldDrag,
  writeHodosWorldDrag,
} from "../src/world-drag.js";

class Transfer {
  constructor() {
    this.values = new Map();
    this.types = [];
    this.effectAllowed = "none";
  }

  setData(type, value) {
    this.values.set(type, value);
    if (!this.types.includes(type)) this.types.push(type);
  }

  getData(type) {
    return this.values.get(type) ?? "";
  }
}

test("round-trips a typed Hodos world payload", () => {
  const transfer = new Transfer();
  const payload = { type: "studio/track", id: "source-1", track: "track-1", label: "Guitar" };
  writeHodosWorldDrag(transfer, payload);
  assert.equal(transfer.effectAllowed, "copy");
  assert.equal(hasHodosWorldDrag(transfer), true);
  assert.deepEqual(readHodosWorldDrag(transfer), payload);
  assert.ok(transfer.types.includes(HODOS_WORLD_DRAG_TYPE));
});

test("rejects malformed and oversized world payloads", () => {
  const transfer = new Transfer();
  assert.throws(() => writeHodosWorldDrag(transfer, { id: "missing-type" }), /requires a type/);
  transfer.setData(HODOS_WORLD_DRAG_TYPE, "not-json");
  assert.throws(() => readHodosWorldDrag(transfer), /invalid JSON/);
  assert.throws(
    () => writeHodosWorldDrag(new Transfer(), { type: "test", value: "x".repeat(70 * 1024) }),
    /too large/,
  );
});
