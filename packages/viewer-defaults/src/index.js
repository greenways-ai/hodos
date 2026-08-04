import "@greenways/hodos-renderer-playcanvas/styles";
import { defineAddon, hodosCoreAddon } from "@greenways/hodos-core";
import {
  hodosPlayCanvasRendererAddon,
  HODOS_PLAYCANVAS_RENDERER_ADDON_ID,
} from "@greenways/hodos-renderer-playcanvas";
import {
  hodosGithubSourceAddon,
  HODOS_GITHUB_SOURCE_ADDON_ID,
} from "@greenways/hodos-source-github";
import { hodosViewerAddon, HODOS_VIEWER_ADDON_ID } from "@greenways/hodos-viewer";
import { hodosWorldModelAddon } from "@greenways/hodos-world-model";

export const HODOS_DEFAULT_VIEWER_ADDON_ID = "@greenways/hodos-viewer-defaults";

export const hodosDefaultViewerAddon = defineAddon({
  manifest: {
    id: HODOS_DEFAULT_VIEWER_ADDON_ID,
    version: "0.1.0",
    requires: {
      [HODOS_GITHUB_SOURCE_ADDON_ID]: "^0.1.0",
      [HODOS_PLAYCANVAS_RENDERER_ADDON_ID]: "^0.1.0",
      [HODOS_VIEWER_ADDON_ID]: "^0.1.0",
    },
    capabilities: [],
  },
});

export const hodosViewerDistribution = Object.freeze([
  hodosCoreAddon,
  hodosWorldModelAddon,
  hodosGithubSourceAddon,
  hodosPlayCanvasRendererAddon,
  hodosViewerAddon,
  hodosDefaultViewerAddon,
]);

export default hodosDefaultViewerAddon;
