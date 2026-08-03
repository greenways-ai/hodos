import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("demo consumes the viewer package and installs the spatial studio host", () => {
  const source = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(source, /createHodosViewer/);
  assert.match(source, /hodos\/studio/);
  assert.match(source, /STUDIO_TOUCHPOINTS/);
  assert.match(source, /withStudioHistory/);
  assert.match(source, /withStudioBundleImport/);
  assert.match(source, /withStudioClipEditing/);
  assert.match(source, /withStudioTrackManagement/);
  assert.match(source, /SpatialAudioRuntime/);
  assert.match(source, /sync-world-sources/);
  assert.match(source, /createWorldDraftStore/);
  assert.match(source, /save-world-draft/);
  assert.match(source, /world\/draft-restore/);
  assert.doesNotMatch(source, /class WorldRenderer/);
});
