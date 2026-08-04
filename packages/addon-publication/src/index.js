import { defineAddon, HODOS_CORE_ADDON_ID } from "@greenways/hodos-core";
import { HODOS_DRAFTS_ADDON_ID } from "@greenways/hodos-addon-drafts";

export const HODOS_PUBLICATION_ADDON_ID = "@greenways/hodos-addon-publication";

export const hodosPublicationAddon = defineAddon({
  manifest: {
    id: HODOS_PUBLICATION_ADDON_ID,
    version: "0.1.0",
    requires: {
      [HODOS_CORE_ADDON_ID]: "^0.1.0",
      [HODOS_DRAFTS_ADDON_ID]: "^0.1.0",
    },
    capabilities: ["publication.intent"],
  },
  activate(context) {
    context.contribute("hara.module", "gw.hodos.session-publication", {
      namespace: "gw.hodos.session-publication",
      package: "greenways/hodos-addon-publication",
    });
  },
});

export default hodosPublicationAddon;
