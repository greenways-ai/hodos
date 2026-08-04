import { defineAddon, HODOS_CORE_ADDON_ID } from "@greenways/hodos-core";
import { HODOS_DRAFTS_ADDON_ID } from "@greenways/hodos-addon-drafts";
import { HODOS_PUBLICATION_ADDON_ID } from "@greenways/hodos-addon-publication";

export const HODOS_AUTHORING_ADDON_ID = "@greenways/hodos-addon-authoring";

export const hodosAuthoringAddon = defineAddon({
  manifest: {
    id: HODOS_AUTHORING_ADDON_ID,
    version: "0.1.0",
    requires: {
      [HODOS_CORE_ADDON_ID]: "^0.1.0",
      [HODOS_DRAFTS_ADDON_ID]: "^0.1.0",
      [HODOS_PUBLICATION_ADDON_ID]: "^0.1.0",
    },
    capabilities: ["workspace.authoring"],
  },
  activate(context) {
    context.contribute("hara.module", "gw.hodos.session-authoring", {
      namespace: "gw.hodos.session-authoring",
      package: "greenways/hodos-addon-authoring",
    });
  },
});

export default hodosAuthoringAddon;
