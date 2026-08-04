import { defineAddon, hodosCoreAddon, HODOS_CORE_ADDON_ID } from "@greenways/hodos-core";
import { hodosDraftsAddon, HODOS_DRAFTS_ADDON_ID } from "@greenways/hodos-addon-drafts";
import { hodosPublicationAddon, HODOS_PUBLICATION_ADDON_ID } from "@greenways/hodos-addon-publication";
import { hodosAuthoringAddon, HODOS_AUTHORING_ADDON_ID } from "@greenways/hodos-addon-authoring";

export const HODOS_HARA_RUNTIME_ADDON_ID = "@greenways/hodos-runtime-hara";

const REQUIRED_MODULES = Object.freeze([
  "gw.hodos.adaptor",
  "gw.hodos.bundle",
  "gw.hodos.package",
  "gw.hodos.scene",
  "gw.hodos.session",
  "gw.hodos.session-draft",
  "gw.hodos.session-publication",
  "gw.hodos.session-authoring",
  "gw.hodos.kernel",
]);

export const hodosHaraRuntimeAddon = defineAddon({
  manifest: {
    id: HODOS_HARA_RUNTIME_ADDON_ID,
    version: "0.1.0",
    requires: {
      [HODOS_CORE_ADDON_ID]: "^0.1.0",
      [HODOS_DRAFTS_ADDON_ID]: "^0.1.0",
      [HODOS_PUBLICATION_ADDON_ID]: "^0.1.0",
      [HODOS_AUTHORING_ADDON_ID]: "^0.1.0",
    },
    capabilities: ["runtime.hara"],
  },
  async activate(context) {
    context.contribute("hara.module", "gw.hodos.kernel", {
      namespace: "gw.hodos.kernel",
      package: "greenways/hodos-runtime-hara",
    });
    const modules = new Set(context.listContributions("hara.module").map(({ id }) => id));
    const missing = REQUIRED_MODULES.filter((namespace) => !modules.has(namespace));
    if (missing.length) throw new Error(`Hodos Hara runtime is missing modules: ${missing.join(", ")}`);
    const runtime = await import("../runtime/hodos-runtime.js");
    context.contribute("runtime", "hara", Object.freeze({
      invoke: runtime.invokeHodos,
      evaluateScript: runtime.evaluateHodosScript,
      activatePackages: runtime.activateLockedPackages,
      capabilities: runtime.hodosCapabilities,
    }));
  },
});

export const hodosHaraDistribution = Object.freeze([
  hodosCoreAddon,
  hodosDraftsAddon,
  hodosPublicationAddon,
  hodosAuthoringAddon,
  hodosHaraRuntimeAddon,
]);

export default hodosHaraRuntimeAddon;
