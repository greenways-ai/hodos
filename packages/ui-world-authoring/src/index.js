import { defineAddon, HODOS_CORE_ADDON_ID } from "@greenways/hodos-core";
import { HODOS_PLAYCANVAS_RENDERER_ADDON_ID } from "@greenways/hodos-renderer-playcanvas";
import { HODOS_WORLD_MODEL_ADDON_ID } from "@greenways/hodos-world-model";

export * from "./rigging-workfile-browser.js";

export const HODOS_WORLD_AUTHORING_UI_ADDON_ID = "@greenways/hodos-ui-world-authoring";
export const HODOS_WORLD_AUTHORING_COMPONENT_ID = "hodos.world/authoring";
export const HODOS_RIGGING_AUTHORING_COMPONENT_ID = "hodos.rigging/authoring";

export const HODOS_WORLD_AUTHORING_EVENTS = Object.freeze([
  "world/document-commit",
  "world/editor-mode",
  "world/editor-select",
  "world/editor-tool",
  "world/editor-settings",
  "world/editor-transform-selection",
  "world/entity-create",
  "world/entity-update",
  "world/entity-transform",
  "world/entity-duplicate",
  "world/entity-delete",
  "world/audio-move",
  "world/audio-gain",
  "world/audio-range",
  "world/audio-loop",
  "world/audio-toggle",
  "world/audio-remove",
  "world/history-undo",
  "world/history-redo",
  "world/draft-export",
  "world/script-run",
]);

export const HODOS_RIGGING_AUTHORING_EVENTS = Object.freeze([
  "rig/source-opened",
  "rig/authoring-replace",
  "rig/editor-select",
  "rig/editor-settings",
  "rig/editor-toggle-expanded",
  "rig/editor-focus",
  "rig/intent",
  "rig/history-undo",
  "rig/history-redo",
]);

const stateModel = (model) => (
  model && typeof model === "object" && !Array.isArray(model) && Object.hasOwn(model, "state")
    ? model.state
    : model
);

const hostFactory = (options, services) => {
  const candidate = options.createWorldAuthoringHost
    ?? services?.createWorldAuthoringHost
    ?? services?.worldAuthoring?.createHost;
  if (typeof candidate !== "function") {
    throw new Error("Hodos World Authoring requires an injected createWorldAuthoringHost service");
  }
  return candidate;
};

const riggingHostFactory = (options, services) => {
  const candidate = options.createRiggingAuthoringHost
    ?? services?.createRiggingAuthoringHost
    ?? services?.rigging?.createAuthoringHost;
  if (typeof candidate !== "function") {
    throw new Error("Hodos Rigging Authoring requires an injected createRiggingAuthoringHost service");
  }
  return candidate;
};

function componentFactory(factoryFor, requirement) {
  return (options = {}) => ({ root, model, services, dispatch, context }) => {
    const createHost = factoryFor(options, services);
    const host = createHost({
      root,
      container: root,
      model: stateModel(model),
      services,
      dispatch,
      context,
    });
    if (!host || typeof host !== "object") throw new TypeError(`${requirement} must return a host object`);
    if (typeof host.update !== "function") throw new TypeError(`${requirement} host must implement update(state)`);
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
}

export const createWorldAuthoringComponentFactory = componentFactory(
  hostFactory,
  "createWorldAuthoringHost",
);

export const createRiggingAuthoringComponentFactory = componentFactory(
  riggingHostFactory,
  "createRiggingAuthoringHost",
);

function register(registry, id, factory) {
  if (!registry || typeof registry.register !== "function") {
    throw new TypeError("Hodos authoring registration requires a Hodos component registry");
  }
  return registry.register(id, factory);
}

export function registerHodosWorldAuthoringUi(registry, options = {}) {
  return register(registry, HODOS_WORLD_AUTHORING_COMPONENT_ID, createWorldAuthoringComponentFactory(options));
}

export function registerHodosRiggingAuthoringUi(registry, options = {}) {
  return register(registry, HODOS_RIGGING_AUTHORING_COMPONENT_ID, createRiggingAuthoringComponentFactory(options));
}

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
    const rigging = context.getContribution("rig.renderer", "playcanvas");
    if (!renderer) throw new Error("Hodos world-authoring UI requires the PlayCanvas renderer contribution");
    if (!rigging) throw new Error("Hodos rigging UI requires the PlayCanvas rig renderer contribution");
    renderer.installAdvanced();
    const [{ WorldDraftPanel }, { WorldEditorWorkspace }, { RiggingWorkspace, createRiggingWorkspaceHost }] = await Promise.all([
      import("./world-draft-panel.js"),
      import("./world-editor-workspace.js"),
      import("./rigging-workspace.js"),
    ]);
    context.contribute("world.ui", "authoring", Object.freeze({
      DraftPanel: WorldDraftPanel,
      Workspace: WorldEditorWorkspace,
    }));
    context.contribute("rig.ui", "authoring", Object.freeze({
      Workspace: RiggingWorkspace,
      createHost: createRiggingWorkspaceHost,
    }));
  },
});

export default hodosWorldAuthoringUiAddon;
