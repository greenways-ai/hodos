import { AdvancedWorldRenderer } from "./advanced-world-renderer.js";
import { WorldRenderer } from "./world-renderer.js";
import { normalizeAdvancedEditor, normalizeAuthoringDocument } from "./world-authoring-model.js";

let installed = false;

export function enhanceWorldRenderer(renderer) {
  if (!renderer || renderer.__hodosAdvancedRenderer) return renderer;
  renderer.__hodosAdvancedRenderer = true;
  const previousUpdate = renderer.updateOverlays;

  for (const name of Object.getOwnPropertyNames(AdvancedWorldRenderer.prototype)) {
    if (name === "constructor") continue;
    Object.defineProperty(renderer, name, {
      configurable: true,
      writable: true,
      value: AdvancedWorldRenderer.prototype[name],
    });
  }

  renderer.document = normalizeAuthoringDocument();
  renderer.editor = normalizeAdvancedEditor(renderer.editor);
  renderer.selectionMode = "replace";
  renderer.selectionBox = null;
  renderer.pivotMarker = null;
  renderer.gizmoVisual = null;
  renderer.gizmoMaterials = [];
  renderer.timelineClock = null;
  renderer.timelineReportedAt = 0;
  renderer.assetInstances = new Map();

  renderer.app.off("update", previousUpdate, renderer);
  renderer.gizmo?.root.remove();
  renderer.gizmo = null;
  renderer.createEditorGizmo();

  renderer.canvas.addEventListener("pointerdown", (event) => {
    renderer.selectionMode = event.shiftKey
      ? "toggle"
      : event.metaKey || event.ctrlKey
        ? "add"
        : "replace";
  }, { capture: true, signal: renderer.abort.signal });
  renderer.installBoxSelection();
  renderer.installPlaneHandles();
  renderer.createGeometricGizmo();
  renderer.createPivotMarker();
  renderer.app.on("update", renderer.updateOverlays, renderer);
  renderer.updateEditorGizmo();
  return renderer;
}

export function installAdvancedWorldRendererPrototype() {
  if (installed) return;
  installed = true;
  const advancedSync = AdvancedWorldRenderer.prototype.syncEditorDocument;
  WorldRenderer.prototype.syncEditorDocument = function syncEditorDocument(document, editor) {
    enhanceWorldRenderer(this);
    return advancedSync.call(this, document, editor);
  };
}
