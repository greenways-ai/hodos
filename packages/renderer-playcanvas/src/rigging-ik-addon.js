import {
  HODOS_CORE_ADDON_ID,
  defineAddon,
} from "@greenways/hodos-core";
import { HODOS_WORLD_MODEL_ADDON_ID } from "@greenways/hodos-world-model";
import {
  RIG_IK_PROVIDER_ID,
  RIG_IK_PROVIDER_VERSION,
  RiggingIkProvider,
  createRiggingIkProvider,
  solveRiggingIk,
} from "./rigging-ik.js";

export * from "./rigging-ik.js";

export const HODOS_PLAYCANVAS_RIGGING_IK_ADDON_ID = "@greenways/hodos-renderer-playcanvas/rigging-ik";

export const hodosPlayCanvasRiggingIkAddon = defineAddon({
  manifest: {
    id: HODOS_PLAYCANVAS_RIGGING_IK_ADDON_ID,
    version: "0.1.0",
    requires: {
      [HODOS_CORE_ADDON_ID]: "^0.1.0",
      [HODOS_WORLD_MODEL_ADDON_ID]: "^0.1.0",
    },
    capabilities: ["rig.ik"],
  },
  activate(context) {
    context.capabilities.require("rig.ik");
    context.contribute("rig.ik", "playcanvas-local", Object.freeze({
      Provider: RiggingIkProvider,
      create: createRiggingIkProvider,
      providerId: RIG_IK_PROVIDER_ID,
      providerVersion: RIG_IK_PROVIDER_VERSION,
      solve: solveRiggingIk,
    }));
  },
});

export default hodosPlayCanvasRiggingIkAddon;
