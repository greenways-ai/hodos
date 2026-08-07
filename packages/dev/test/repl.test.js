import assert from "node:assert/strict";
import test from "node:test";
import {
  HODOS_DEV_REPL_AREA_TYPE,
  HODOS_DEV_REPL_COMPONENT_ID,
  createReplArea,
} from "../src/index.js";

test("REPL area is a serializable HAL-shaped Workspace value", () => {
  const area = createReplArea({
    sessionId: "session/project",
    namespace: "app.core",
    status: "ready",
    entries: [
      { id: "entry/1", kind: "input", namespace: "app.core", text: "(+ 1 2)" },
      { id: "entry/2", kind: "result", text: "3", requestId: "request/1" },
    ],
    history: ["(+ 1 2)"],
    historyIndex: 1,
  });
  const component = area["area/component"];
  assert.equal(area["area/type"], HODOS_DEV_REPL_AREA_TYPE);
  assert.equal(component["component/id"], HODOS_DEV_REPL_COMPONENT_ID);
  assert.equal(component["component/contract"], "workspace.component/1");
  assert.equal(component["component/model"].session.status, "ready");
  assert.deepEqual(component["component/model"].entries.map(({ kind, text }) => ({ kind, text })), [
    { kind: "input", text: "(+ 1 2)" },
    { kind: "result", text: "3" },
  ]);
  assert.equal(JSON.parse(JSON.stringify(area))["area/id"], "repl/main");
});

test("REPL area validates status, entries, history and input", () => {
  assert.throws(() => createReplArea({ status: "playing" }), /Unsupported.*status/);
  assert.throws(() => createReplArea({ entries: [{ kind: "trace", text: "x" }] }), /unsupported kind/);
  assert.throws(() => createReplArea({ entries: [{ kind: "result", text: null }] }), /text must be a string/);
  assert.throws(() => createReplArea({ history: [1] }), /array of strings/);
  assert.throws(() => createReplArea({ input: null }), /input must be a string/);
  assert.throws(() => createReplArea({ history: [], historyIndex: 1 }), /address the history array/);
});
