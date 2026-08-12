import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  createRiggingDemoState,
  RIGGING_DEMO_EXPERIENCE,
  riggingDemoSummary,
} from "../src/rigging-demo-model.js";

test("the demo exposes rigging through the standard Hodos component host", () => {
  const main = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const demo = fs.readFileSync(new URL("../src/rigging-demo.js", import.meta.url), "utf8");
  assert.match(main, /RIGGING_DEMO_EXPERIENCE/);
  assert.match(main, /data-rigging-workbench/);
  assert.match(demo, /createHodosComponentRegistry/);
  assert.match(demo, /createHodosComponentHost/);
  assert.match(demo, /registerHodosRiggingAuthoringUi/);
  assert.match(demo, /HODOS_RIGGING_AUTHORING_COMPONENT_ID/);
  assert.match(demo, /getContribution\(kind, name\)/);
  assert.match(demo, /"rig\.ui", "authoring"/);
  assert.match(demo, /"rig\.renderer", "playcanvas"/);
  assert.match(demo, /"rig\.asset-host", "playcanvas-local"/);
  assert.doesNotMatch(demo, /new RiggingWorkspace/);
  assert.equal(RIGGING_DEMO_EXPERIENCE, "rigging");
});

test("rigging demo state remains portable and contains no model bytes", () => {
  const state = createRiggingDemoState({
    sessionId: "rig-session:test",
    historyLimit: 12,
  });
  const summary = riggingDemoSummary(state);
  assert.equal(summary.contentId, null);
  assert.equal(summary.revision, 0);
  assert.equal(summary.joints, 0);
  const encoded = JSON.stringify(state);
  assert.doesNotMatch(encoded, /ArrayBuffer|Uint8Array|playcanvas|gpu/i);
  assert.equal(state.history.limit, 12);
});

test("the packaged example is a valid binary glTF container", () => {
  const bytes = fs.readFileSync(new URL("../public/rigging-stylized-unrigged.glb", import.meta.url));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.byteLength);
  assert.ok(bytes.byteLength < 16 * 1024, "fixture should stay small enough for a browser smoke test");
});

test("mobile rigging navigation is explicit and canvas gestures do not focus inputs", () => {
  const source = fs.readFileSync(new URL("../src/rigging-demo.js", import.meta.url), "utf8");
  const styles = fs.readFileSync(new URL("../src/rigging-demo.css", import.meta.url), "utf8");
  assert.match(source, /Back to Hodos demos/);
  assert.match(source, /Device only · no upload/);
  assert.doesNotMatch(source, /\.focus\(/);
  assert.match(styles, /touch-action:\s*none/);
  assert.match(styles, /@media \(max-width: 760px\)/);
});
