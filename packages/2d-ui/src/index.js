import {
  HODOS_2D_DOCUMENT_COMPONENT_ID,
  HODOS_2D_GRAPH_COMPONENT_ID,
} from "@greenways/hodos-2d";
import {
  createDocumentDomHost,
} from "./document-dom-host.js";
import {
  createGraphDomHost,
} from "./graph-dom-host.js";

export {
  createDocumentDomHost,
  createHodosDocumentDomHost,
  projectDocumentDomView,
} from "./document-dom-host.js";

export {
  createGraphDomHost,
  createHodosGraphDomHost,
  projectGraphDomView,
} from "./graph-dom-host.js";

const hostFactory = (name, options, services, optionKey, serviceKey) => {
  const candidate = options[optionKey]
    ?? services?.[optionKey]
    ?? services?.[serviceKey]?.createHost;
  if (typeof candidate !== "function") {
    throw new Error(`Hodos 2D ${name} requires an injected ${optionKey} service`);
  }
  return candidate;
};

const statefulComponentFactory = (name, optionKey, serviceKey, options = {}) =>
  ({ root, model, services, dispatch, context }) => {
    const createHost = hostFactory(name, options, services, optionKey, serviceKey);
    const host = createHost({
      container: root,
      model,
      services,
      dispatch,
      context,
    });
    if (!host || typeof host !== "object") {
      throw new TypeError(`Injected ${optionKey} must return a ${name} host object`);
    }
    if (typeof host.update !== "function") {
      throw new TypeError(`Injected Hodos 2D ${name} host must implement update(model)`);
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

export const createDocumentComponentFactory = (options = {}) =>
  statefulComponentFactory("Document", "createDocumentHost", "document", options);

export const createGraphComponentFactory = (options = {}) =>
  statefulComponentFactory("Graph", "createGraphHost", "graph", options);

const register = (registry, id, factory, label) => {
  if (!registry || typeof registry.register !== "function") {
    throw new TypeError(`${label} requires a Hodos component registry`);
  }
  return registry.register(id, factory);
};

export function registerHodosDocumentUi(registry, options = {}) {
  return register(
    registry,
    HODOS_2D_DOCUMENT_COMPONENT_ID,
    createDocumentComponentFactory(options),
    "registerHodosDocumentUi",
  );
}

/**
 * Registers the product-neutral safe DOM implementation. Runtime evaluation,
 * artefact rendering and mutation policy remain injected through services and
 * semantic events.
 */
export function registerHodosDocumentDomUi(registry, options = {}) {
  const documentDom = options.documentDom ?? {};
  const createDocumentHost = options.createDocumentHost
    ?? ((hostOptions) => createDocumentDomHost({ ...documentDom, ...hostOptions }));
  return registerHodosDocumentUi(registry, {
    ...options,
    createDocumentHost,
  });
}

export function registerHodosGraphUi(registry, options = {}) {
  return register(
    registry,
    HODOS_2D_GRAPH_COMPONENT_ID,
    createGraphComponentFactory(options),
    "registerHodosGraphUi",
  );
}

/**
 * Registers the product-neutral safe DOM/SVG graph implementation. Graph
 * mutation remains an application responsibility reached through graph/*
 * semantic events.
 */
export function registerHodosGraphDomUi(registry, options = {}) {
  const graphDom = options.graphDom ?? {};
  const createGraphHost = options.createGraphHost
    ?? ((hostOptions) => createGraphDomHost({ ...graphDom, ...hostOptions }));
  return registerHodosGraphUi(registry, {
    ...options,
    createGraphHost,
  });
}

export function registerHodos2dUi(registry, options = {}) {
  const disposers = [];
  try {
    disposers.push(registerHodosDocumentUi(registry, options));
    disposers.push(registerHodosGraphUi(registry, options));
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose();
    throw error;
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
