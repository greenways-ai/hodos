import { defineAddon, HODOS_CORE_ADDON_ID } from "@greenways/hodos-core";
import { HODOS_WORLD_MODEL_ADDON_ID } from "@greenways/hodos-world-model";
import { AdvancedWorldRenderer } from "./advanced-world-renderer.js";
import {
  LocalRiggingAssetHost,
  createLocalRiggingAssetHost,
} from "./rigging-asset-host.js";
import { RiggingAuthoringRenderer } from "./rigging-authoring-renderer.js";
import {
  bindGeometryEvidence,
  buildRiggingBindGeometry,
  destroyRiggingBindGeometry,
} from "./rigging-bind-geometry.js";
import {
  analyzeLocalGlb,
  preflightLocalGlb,
} from "./rigging-glb-preflight.js";
import { RigSkeletonOverlay } from "./rigging-skeleton-overlay.js";
import { RigTranslateHandles } from "./rigging-translate-handles.js";
import { RiggingWeightArtifactStore } from "./rigging-weight-artifacts.js";
import { RiggingWeightEditingStore } from "./rigging-weight-editing.js";
import { RigWeightHeatmapOverlay } from "./rigging-weight-heatmap.js";
import { RiggingWeightStrokeController } from "./rigging-weight-painter.js";
import { RiggingWeightSelectionStore } from "./rigging-weight-selections.js";
import { RiggingWeightTaskRunner } from "./rigging-weight-task.js";
import {
  buildRiggingSurfaceIndex,
  destroyRiggingSurfaceIndex,
  raycastRiggingSurface,
  surfaceIndexEvidence,
} from "./rigging-surface-index.js";
import {
  enhanceWorldRenderer,
  installAdvancedWorldRendererPrototype,
} from "./world-renderer-enhancer.js";
import { WorldRenderer } from "./world-renderer.js";

export { AdvancedWorldRenderer } from "./advanced-world-renderer.js";
export {
  LocalRiggingAssetHost,
  createLocalRiggingAssetHost,
} from "./rigging-asset-host.js";
export * from "./rigging-authoring-renderer.js";
export * from "./rigging-bind-geometry.js";
export * from "./rigging-glb-preflight.js";
export * from "./rigging-skeleton-overlay.js";
export * from "./rigging-surface-index.js";
export * from "./rigging-translate-handles.js";
export * from "./rigging-weight-artifacts.js";
export * from "./rigging-weight-editing.js";
export * from "./rigging-weight-heatmap.js";
export * from "./rigging-weight-painter.js";
export * from "./rigging-weight-selections.js";
export * from "./rigging-weight-task.js";
export { enhanceWorldRenderer, installAdvancedWorldRendererPrototype } from "./world-renderer-enhancer.js";
export { WorldRenderer } from "./world-renderer.js";

export const HODOS_PLAYCANVAS_RENDERER_ADDON_ID = "@greenways/hodos-renderer-playcanvas";

export const hodosPlayCanvasRendererAddon = defineAddon({
  manifest: {
    id: HODOS_PLAYCANVAS_RENDERER_ADDON_ID,
    version: "0.1.0",
    requires: {
      [HODOS_CORE_ADDON_ID]: "^0.1.0",
      [HODOS_WORLD_MODEL_ADDON_ID]: "^0.1.0",
    },
    capabilities: ["world.render"],
  },
  activate(context) {
    context.contribute("world.renderer", "playcanvas", Object.freeze({
      AdvancedRenderer: AdvancedWorldRenderer,
      Renderer: WorldRenderer,
      enhance: enhanceWorldRenderer,
      installAdvanced: installAdvancedWorldRendererPrototype,
    }));
    context.contribute("rig.asset-host", "playcanvas-local", Object.freeze({
      Host: LocalRiggingAssetHost,
      create: createLocalRiggingAssetHost,
      analyze: analyzeLocalGlb,
      preflight: preflightLocalGlb,
    }));
    context.contribute("rig.renderer", "playcanvas", Object.freeze({
      AuthoringRenderer: RiggingAuthoringRenderer,
      SkeletonOverlay: RigSkeletonOverlay,
      TranslateHandles: RigTranslateHandles,
    }));
    context.contribute("rig.surface", "playcanvas-local", Object.freeze({
      build: buildRiggingSurfaceIndex,
      destroy: destroyRiggingSurfaceIndex,
      evidence: surfaceIndexEvidence,
      raycast: raycastRiggingSurface,
    }));
    context.contribute("rig.weights", "playcanvas-local", Object.freeze({
      ArtifactStore: RiggingWeightArtifactStore,
      EditingStore: RiggingWeightEditingStore,
      HeatmapOverlay: RigWeightHeatmapOverlay,
      PaintController: RiggingWeightStrokeController,
      SelectionStore: RiggingWeightSelectionStore,
      TaskRunner: RiggingWeightTaskRunner,
      buildGeometry: buildRiggingBindGeometry,
      destroyGeometry: destroyRiggingBindGeometry,
      geometryEvidence: bindGeometryEvidence,
    }));
  },
});

export default hodosPlayCanvasRendererAddon;
