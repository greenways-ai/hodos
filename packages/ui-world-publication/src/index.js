import { defineAddon, HODOS_CORE_ADDON_ID } from "@greenways/hodos-core";

export const HODOS_WORLD_PUBLICATION_UI_ADDON_ID = "@greenways/hodos-ui-world-publication";

export const hodosWorldPublicationUiAddon = defineAddon({
  manifest: {
    id: HODOS_WORLD_PUBLICATION_UI_ADDON_ID,
    version: "0.1.0",
    requires: { [HODOS_CORE_ADDON_ID]: "^0.1.0" },
    capabilities: ["publication.intent", "workspace.drafts"],
  },
  async activate(context) {
    const { WorldDraftReviewPanel } = await import("./world-draft-review-panel.js");
    context.contribute("world.ui", "publication", Object.freeze({
      ReviewPanel: WorldDraftReviewPanel,
    }));
  },
});

export default hodosWorldPublicationUiAddon;
