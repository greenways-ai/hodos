import { defineAddon, HODOS_CORE_ADDON_ID } from "@greenways/hodos-core";
import { TahtoWorldSource } from "./tahto-worlds.js";

export * from "./tahto-worlds.js";

export const HODOS_TAHTO_SOURCE_ADDON_ID = "@greenways/hodos-source-tahto";

export const hodosTahtoSourceAddon = defineAddon({
  manifest: {
    id: HODOS_TAHTO_SOURCE_ADDON_ID,
    version: "0.1.0",
    requires: { [HODOS_CORE_ADDON_ID]: "^0.1.0" },
    capabilities: ["tahto.read", "tahto.write"],
  },
  activate(context) {
    context.contribute("world.source", "tahto", Object.freeze({
      Client: TahtoWorldSource,
      id: "tahto",
      label: "Tahto",
      authority: "greenways-os-capability-broker",
    }));
  },
});

export default hodosTahtoSourceAddon;
