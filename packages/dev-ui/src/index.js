import {
  HODOS_DEV_EDITOR_COMPONENT_ID,
  HODOS_DEV_PREVIEW_COMPONENT_ID,
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

export function createEditorComponentFactory(options = {}) {
  return ({ root, model, services, dispatch, context }) => {
    const createEditorHost = hostFactory("Editor", options, services, "createEditorHost", "editor");
    const host = createEditorHost({
      container: root,
      model,
      dispatch,
      context,
    });
    if (!host || typeof host !== "object") {
      throw new TypeError("Injected createEditorHost must return an editor host object");
    }
    if (typeof host.update !== "function") {
      throw new TypeError("Injected Hodos Dev Editor host must implement update(model)");
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

export function registerHodosPreviewUi(registry, options = {}) {
  if (!registry || typeof registry.register !== "function") {
    throw new TypeError("registerHodosPreviewUi requires a Hodos component registry");
  }
  return registry.register(
    HODOS_DEV_PREVIEW_COMPONENT_ID,
    createPreviewComponentFactory(options),
  );
}

export function registerHodosEditorUi(registry, options = {}) {
  if (!registry || typeof registry.register !== "function") {
    throw new TypeError("registerHodosEditorUi requires a Hodos component registry");
  }
  return registry.register(
    HODOS_DEV_EDITOR_COMPONENT_ID,
    createEditorComponentFactory(options),
  );
}

export function registerHodosDevUi(registry, options = {}) {
  const disposers = [];
  try {
    disposers.push(registerHodosPreviewUi(registry, options));
    disposers.push(registerHodosEditorUi(registry, options));
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose();
    throw error;
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
