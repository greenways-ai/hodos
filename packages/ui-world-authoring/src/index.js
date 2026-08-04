import { defineAddon, HODOS_CORE_ADDON_ID } from "@greenways/hodos-core";
import { HODOS_PLAYCANVAS_RENDERER_ADDON_ID } from "@greenways/hodos-renderer-playcanvas";
import { HODOS_WORLD_MODEL_ADDON_ID } from "@greenways/hodos-world-model";

export const HODOS_WORLD_AUTHORING_UI_ADDON_ID = "@greenways/hodos-ui-world-authoring";

export const hodosWorldAuthoringUiAddon = defineAddon({
  manifest: {
    id: HODOS_WORLD_AUTHORING_UI_ADDON_ID,
    version: "0.1.0",
    requires: {
      [HODOS_CORE_ADDON_ID]: "^0.1.0",
      [HODOS_PLAYCANVAS_RENDERER_ADDON_ID]: "^0.1.0",
      [HODOS_WORLD_MODEL_ADDON_ID]: "^0.1.0",
    },
    capabilities: ["workspace.authoring", "workspace.drafts"],
  },
  async activate(context) {
    const renderer = context.getContribution("world.renderer", "playcanvas");
    if (!renderer) throw new Error("Hodos world-authoring UI requires the PlayCanvas renderer contribution");
    renderer.installAdvanced();
    const [{ WorldDraftPanel }, { WorldEditorWorkspace }] = await Promise.all([
      import("./world-draft-panel.js"),
      import("./world-editor-workspace.js"),
    ]);
    context.contribute("world.ui", "authoring", Object.freeze({
      DraftPanel: WorldDraftPanel,
      Workspace: WorldEditorWorkspace,
    }));
  },
});

export default hodosWorldAuthoringUiAddon;
