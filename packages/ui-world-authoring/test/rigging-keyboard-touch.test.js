import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(new URL("../src/rigging-workspace.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/rigging-workspace.css", import.meta.url), "utf8");
const renderer = await readFile(new URL("../../renderer-playcanvas/src/rigging-authoring-renderer.js", import.meta.url), "utf8");

test("rigging workspace coalesces keyboard movement and exposes explicit numeric boundaries", () => {
  for (const token of [
    "RIG_NUDGE_KEYS",
    "nudgeRigMoveTransaction",
    "commitMoveTransaction",
    "cancelMoveTransaction",
    'event.key === "Enter"',
    'event.key === "Escape"',
    "Shift-A add child",
  ]) assert.match(workspace, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(workspace, /addEventListener\("blur"[^\n]*commitMoveTransaction/);
});

test("workbench exposes live announcements and restores hierarchy focus", () => {
  assert.match(workspace, /aria-live="polite"/);
  assert.match(workspace, /focusCurrentTreeItem/);
  assert.match(workspace, /Undo restored/);
  assert.match(workspace, /Rig operation rejected/);
});

test("renderer uses touch-sized picking and projected axis handles", () => {
  assert.match(renderer, /RigTranslateHandles/);
  assert.match(renderer, /pointerType === "touch" \? 36/);
  assert.match(renderer, /commitRigJointMove/);
  assert.match(styles, /hodos-rigging-translate-handle/);
  assert.match(styles, /touch-action: none/);
  assert.match(styles, /@media \(forced-colors: active\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
