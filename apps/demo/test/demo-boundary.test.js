import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("demo consumes the viewer package and installs the spatial Studio host", () => {
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

test("viewer package owns the generic Blender-like editor", () => {
  const viewer = fs.readFileSync(new URL("../../../packages/viewer/src/index.js", import.meta.url), "utf8");
  const panel = fs.readFileSync(new URL("../../../packages/viewer/src/world-editor-panel.js", import.meta.url), "utf8");
  const renderer = fs.readFileSync(new URL("../../../packages/viewer/src/world-renderer.js", import.meta.url), "utf8");
  assert.match(viewer, /WorldEditorPanel/);
  assert.match(viewer, /sync-world-entities/);
  assert.match(panel, /Outliner/);
  assert.match(panel, /world\/entity-create/);
  assert.match(panel, /world\/entity-transform/);
  assert.match(panel, /world\/entity-duplicate/);
  assert.match(panel, /world\/entity-delete/);
  assert.match(renderer, /syncWorldEntities/);
  assert.match(renderer, /activateWorldEntityAt/);
  assert.match(renderer, /createEditorGizmo/);
});

test("demo installs the guided tour, inspector and command deck", () => {
  const source = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const surfaces = fs.readFileSync(new URL("../src/showcase-surfaces.js", import.meta.url), "utf8");
  assert.match(source, /SHOWCASE_SURFACE_FACTORIES/);
  assert.match(source, /SHOWCASE_EXPERIENCE/);
  assert.match(source, /firstShowcaseGuideTouchpoint/);
  assert.match(source, /showcase-landing/);
  assert.match(surfaces, /createShowcaseGuideSurface/);
  assert.match(surfaces, /createWorldInspectorSurface/);
  assert.match(surfaces, /createCommandDeckSurface/);
  assert.match(surfaces, /studio\/history-undo/);
  assert.match(surfaces, /world\/publish-repository/);
});
