import { defineAddon, HODOS_CORE_ADDON_ID } from "@greenways/hodos-core";

export const HODOS_DRAFTS_ADDON_ID = "@greenways/hodos-addon-drafts";

export const hodosDraftsAddon = defineAddon({
  manifest: {
    id: HODOS_DRAFTS_ADDON_ID,
    version: "0.1.0",
    requires: { [HODOS_CORE_ADDON_ID]: "^0.1.0" },
    capabilities: ["workspace.drafts"],
  },
  activate(context) {
    context.contribute("hara.module", "gw.hodos.session-draft", {
      namespace: "gw.hodos.session-draft",
      package: "greenways/hodos-addon-drafts",
    });
  },
});

export default hodosDraftsAddon;
