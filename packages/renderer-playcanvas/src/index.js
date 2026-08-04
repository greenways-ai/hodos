import { defineAddon, HODOS_CORE_ADDON_ID } from "@greenways/hodos-core";
import { HODOS_WORLD_MODEL_ADDON_ID } from "@greenways/hodos-world-model";
import { AdvancedWorldRenderer } from "./advanced-world-renderer.js";
import {
  enhanceWorldRenderer,
  installAdvancedWorldRendererPrototype,
} from "./world-renderer-enhancer.js";
import { WorldRenderer } from "./world-renderer.js";

export { AdvancedWorldRenderer } from "./advanced-world-renderer.js";
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
  },
});

export default hodosPlayCanvasRendererAddon;
