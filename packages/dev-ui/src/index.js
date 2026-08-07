import {
  HODOS_DEV_CATALOG_COMPONENT_ID,
  HODOS_DEV_EDITOR_COMPONENT_ID,
  HODOS_DEV_EXPLORER_COMPONENT_ID,
  HODOS_DEV_PREVIEW_COMPONENT_ID,
  HODOS_DEV_PROBLEMS_COMPONENT_ID,
  HODOS_DEV_REPL_COMPONENT_ID,
  HODOS_DEV_VALUE_INSPECTOR_COMPONENT_ID,
} from "@greenways/hodos-dev";

const hostFactory = (name, options, services, optionKey, serviceKey) => {
  const candidate = options[optionKey]
    ?? services?.[optionKey]
    ?? services?.[serviceKey]?.createHost;
  if (typeof candidate !== "function") {
    throw new Error(`Hodos Dev ${name} requires an injected ${optionKey} service`);
  }
  return candidate;
};

const applyPreviewModel = (host, model = {}) => {
  const value = model && typeof model === "object" ? model : { output: model };
  if (value.theme != null) host.setTheme?.(value.theme);
  if (value.viewport != null) host.setViewport?.(value.viewport);
  if (value.document != null) {
    if (typeof host.renderDocument !== "function") {
      throw new Error("Hodos Dev Preview host cannot render a prepared document");
    }
    host.renderDocument(value.document);
    return;
  }
  if (typeof host.render !== "function") {
    throw new Error("Hodos Dev Preview host cannot render a projected output");
  }
  host.render(value.output ?? null);
};

function statefulComponentFactory(name, optionKey, serviceKey, options = {}) {
  return ({ root, model, services, dispatch, context }) => {
    const createHost = hostFactory(name, options, services, optionKey, serviceKey);
    const host = createHost({
      container: root,
      model,
      dispatch,
      context,
    });
    if (!host || typeof host !== "object") {
      throw new TypeError(`Injected ${optionKey} must return a ${name} host object`);
    }
    if (typeof host.update !== "function") {
      throw new TypeError(`Injected Hodos Dev ${name} host must implement update(model)`);
    }
    host.update(model);
    return {
      update(nextModel) {
        host.update(nextModel);
      },
      destroy() {
        host.dispose?.();
        host.destroy?.();
      },
    };
  };
}

export function createPreviewComponentFactory(options = {}) {
  return ({ root, model, services, dispatch, context }) => {
    const createPreviewHost = hostFactory("Preview", options, services, "createPreviewHost", "preview");
    const host = createPreviewHost({
      container: root,
      dispatch,
      context,
      theme: model?.theme,
      viewport: model?.viewport,
    });
    if (!host || typeof host !== "object") {
      throw new TypeError("Injected createPreviewHost must return a preview host object");
    }
    applyPreviewModel(host, model);
    return {
      update(nextModel) {
        applyPreviewModel(host, nextModel);
      },
      destroy() {
        host.dispose?.();
        host.destroy?.();
      },
    };
  };
}

export const createCatalogComponentFactory = (options = {}) =>
  statefulComponentFactory("Catalog", "createCatalogHost", "catalog", options);

export const createEditorComponentFactory = (options = {}) =>
  statefulComponentFactory("Editor", "createEditorHost", "editor", options);

export const createExplorerComponentFactory = (options = {}) =>
  statefulComponentFactory("Explorer", "createExplorerHost", "explorer", options);

export const createReplComponentFactory = (options = {}) =>
  statefulComponentFactory("REPL", "createReplHost", "repl", options);

export const createProblemsComponentFactory = (options = {}) =>
  statefulComponentFactory("Problems", "createProblemsHost", "problems", options);

export const createValueInspectorComponentFactory = (options = {}) =>
  statefulComponentFactory(
    "Value Inspector",
    "createValueInspectorHost",
    "valueInspector",
    options,
  );

function register(registry, id, factory, label) {
  if (!registry || typeof registry.register !== "function") {
    throw new TypeError(`${label} requires a Hodos component registry`);
  }
  return registry.register(id, factory);
}

export function registerHodosCatalogUi(registry, options = {}) {
  return register(
    registry,
    HODOS_DEV_CATALOG_COMPONENT_ID,
    createCatalogComponentFactory(options),
    "registerHodosCatalogUi",
  );
}

export function registerHodosPreviewUi(registry, options = {}) {
  return register(
    registry,
    HODOS_DEV_PREVIEW_COMPONENT_ID,
    createPreviewComponentFactory(options),
    "registerHodosPreviewUi",
  );
}

export function registerHodosEditorUi(registry, options = {}) {
  return register(
    registry,
    HODOS_DEV_EDITOR_COMPONENT_ID,
    createEditorComponentFactory(options),
    "registerHodosEditorUi",
  );
}

export function registerHodosExplorerUi(registry, options = {}) {
  return register(
    registry,
    HODOS_DEV_EXPLORER_COMPONENT_ID,
    createExplorerComponentFactory(options),
    "registerHodosExplorerUi",
  );
}

export function registerHodosReplUi(registry, options = {}) {
  return register(
    registry,
    HODOS_DEV_REPL_COMPONENT_ID,
    createReplComponentFactory(options),
    "registerHodosReplUi",
  );
}

export function registerHodosProblemsUi(registry, options = {}) {
  return register(
    registry,
    HODOS_DEV_PROBLEMS_COMPONENT_ID,
    createProblemsComponentFactory(options),
    "registerHodosProblemsUi",
  );
}

export function registerHodosValueInspectorUi(registry, options = {}) {
  return register(
    registry,
    HODOS_DEV_VALUE_INSPECTOR_COMPONENT_ID,
    createValueInspectorComponentFactory(options),
    "registerHodosValueInspectorUi",
  );
}

export function registerHodosDevUi(registry, options = {}) {
  const disposers = [];
  try {
    disposers.push(registerHodosCatalogUi(registry, options));
    disposers.push(registerHodosPreviewUi(registry, options));
    disposers.push(registerHodosEditorUi(registry, options));
    disposers.push(registerHodosExplorerUi(registry, options));
    disposers.push(registerHodosReplUi(registry, options));
    disposers.push(registerHodosProblemsUi(registry, options));
    disposers.push(registerHodosValueInspectorUi(registry, options));
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose();
    throw error;
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
