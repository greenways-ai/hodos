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
  assert.match(source, /handleHaraScriptEffect/);
  assert.doesNotMatch(source, /class WorldRenderer/);
});

test("the complete world editor composes from modular viewer packages", () => {
  const viewer = fs.readFileSync(new URL("../../../packages/viewer/src/index.js", import.meta.url), "utf8");
  const addon = fs.readFileSync(new URL("../../../packages/ui-world-authoring/src/index.js", import.meta.url), "utf8");
  const workspace = fs.readFileSync(new URL("../../../packages/ui-world-authoring/src/world-editor-workspace.js", import.meta.url), "utf8");
  const panel = fs.readFileSync(new URL("../../../packages/ui-world-authoring/src/world-editor-panel.js", import.meta.url), "utf8");
  const advanced = fs.readFileSync(new URL("../../../packages/ui-world-authoring/src/world-editor-advanced.js", import.meta.url), "utf8");
  const renderer = fs.readFileSync(new URL("../../../packages/renderer-playcanvas/src/advanced-world-renderer.js", import.meta.url), "utf8");
  const model = fs.readFileSync(new URL("../../../packages/world-model/src/world-authoring-model.js", import.meta.url), "utf8");
  assert.match(viewer, /getContribution\("world\.ui", "authoring"\)/);
  assert.doesNotMatch(viewer, /ui-world-authoring/);
  assert.match(addon, /renderer\.installAdvanced/);
  assert.match(workspace, /MultiSelectionEditorPanel/);
  assert.match(panel, /Outliner/);
  assert.match(advanced, /Assets/);
  assert.match(advanced, /Prefabs/);
  assert.match(advanced, /Collections/);
  assert.match(advanced, /Animation/);
  assert.match(advanced, /Hara Scripts/);
  assert.match(advanced, /world\/document-commit/);
  assert.match(renderer, /installBoxSelection/);
  assert.match(renderer, /createGeometricGizmo/);
  assert.match(renderer, /applyTimeline/);
  assert.match(renderer, /loadAssetInstance/);
  assert.match(model, /capturePrefab/);
  assert.match(model, /setAnimationKeyframe/);
  assert.match(model, /attachScript/);
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

test("demo adopts the muted Hodos visual language", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const theme = fs.readFileSync(new URL("../public/hodos-visual-language.css", import.meta.url), "utf8");

  assert.match(html, /hodos-visual-language\.css/);
  assert.match(html, /Hodos Reference Demo/);
  assert.match(html, /href="\.\.\/spec\/"/);
  assert.match(theme, /--hodos-canvas:\s*#0d0e10/);
  assert.match(theme, /--hodos-header-height/);

  for (const scene of [
    "impossible-staircase",
    "lantern-chamber",
    "mirrored-passage",
    "moth-theatre",
    "optical-garden",
    "reflecting-pool",
    "shadow-gallery",
    "veiled-stage",
  ]) {
    assert.match(theme, new RegExp(`visual-language/artwork/hodos/${scene}`));
  }

  assert.match(theme, /\.hodos-world-editor/);
  assert.match(theme, /\.hodos-world-draft/);
  assert.match(theme, /\.hodos-world-review/);
  assert.match(theme, /\.studio-app/);
  assert.match(theme, /\.showcase-guide/);
});
