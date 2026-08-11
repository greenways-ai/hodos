import { defineAddon, HODOS_CORE_ADDON_ID } from "@greenways/hodos-core";
import {
  GITHUB_ORIGINS,
  PublicGitHubClient,
  requestGitHubAccess,
  resolveWorldGraph,
  searchWorldRepositories,
} from "./github-worlds.js";
import {createWorldProviderLaunchIntent} from "./world-provider.js";

export * from "./github-worlds.js";
export * from "./world-manifest.js";
export * from "./world-provider.js";

export const HODOS_GITHUB_SOURCE_ADDON_ID = "@greenways/hodos-source-github";

export const hodosGithubSourceAddon = defineAddon({
  manifest: {
    id: HODOS_GITHUB_SOURCE_ADDON_ID,
    version: "0.1.0",
    requires: { [HODOS_CORE_ADDON_ID]: "^0.1.0" },
    capabilities: ["network.github"],
  },
  activate(context) {
    context.contribute("world.source", "github", Object.freeze({
      Client: PublicGitHubClient,
      createProviderLaunchIntent: createWorldProviderLaunchIntent,
      effect: Object.freeze({ effect: "github", method: "resolve-world" }),
      id: "github",
      label: "GitHub",
      origins: GITHUB_ORIGINS,
      requestAccess: requestGitHubAccess,
      resolve: resolveWorldGraph,
      searchRepositories: searchWorldRepositories,
    }));
  },
});

export default hodosGithubSourceAddon;
