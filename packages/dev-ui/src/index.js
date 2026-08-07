import { HODOS_DEV_PREVIEW_COMPONENT_ID } from "@greenways/hodos-dev";

const previewFactory = (options, services) => {
  const candidate = options.createPreviewHost
    ?? services?.createPreviewHost
    ?? services?.preview?.createHost;
  if (typeof candidate !== "function") {
    throw new Error("Hodos Dev Preview requires an injected createPreviewHost service");
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
    const createPreviewHost = previewFactory(options, services);
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

export function registerHodosDevUi(registry, options = {}) {
  if (!registry || typeof registry.register !== "function") {
    throw new TypeError("registerHodosDevUi requires a Hodos component registry");
  }
  return registry.register(
    HODOS_DEV_PREVIEW_COMPONENT_ID,
    createPreviewComponentFactory(options),
  );
}
