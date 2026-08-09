import { defineAddon, HODOS_CORE_ADDON_ID } from "@greenways/hodos-core";

export const HODOS_WORLD_PUBLICATION_UI_ADDON_ID = "@greenways/hodos-ui-world-publication";
export const HODOS_WORLD_PUBLICATION_COMPONENT_ID = "hodos.world/publication";

export const HODOS_WORLD_PUBLICATION_EVENTS = Object.freeze([
  "world/draft-propose",
  "world/draft-review-toggle",
  "world/draft-review-accept",
  "world/draft-review-reject",
  "world/publish-repository",
  "world/publish-hestia",
]);

const stateModel = (model) => (
  model && typeof model === "object" && !Array.isArray(model) && Object.hasOwn(model, "state")
    ? model.state
    : model
);

const hostFactory = (options, services) => {
  const candidate = options.createWorldPublicationHost
    ?? services?.createWorldPublicationHost
    ?? services?.worldPublication?.createHost;
  if (typeof candidate !== "function") {
    throw new Error("Hodos World Publication requires an injected createWorldPublicationHost service");
  }
  return candidate;
};

export const createWorldPublicationComponentFactory = (options = {}) =>
  ({ root, model, services, dispatch, context }) => {
    const createHost = hostFactory(options, services);
    const host = createHost({
      root,
      container: root,
      model: stateModel(model),
      services,
      dispatch,
      context,
    });
    if (!host || typeof host !== "object") {
      throw new TypeError("createWorldPublicationHost must return a host object");
    }
    if (typeof host.update !== "function") {
      throw new TypeError("Hodos World Publication host must implement update(state)");
    }
    host.update(stateModel(model));
    return {
      update(nextModel) {
        host.update(stateModel(nextModel));
      },
      destroy() {
        if (typeof host.destroy === "function") host.destroy();
        else host.dispose?.();
      },
    };
  };

export function registerHodosWorldPublicationUi(registry, options = {}) {
  if (!registry || typeof registry.register !== "function") {
    throw new TypeError("registerHodosWorldPublicationUi requires a Hodos component registry");
  }
  return registry.register(
    HODOS_WORLD_PUBLICATION_COMPONENT_ID,
    createWorldPublicationComponentFactory(options),
  );
}

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
