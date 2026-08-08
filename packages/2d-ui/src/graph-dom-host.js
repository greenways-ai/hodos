const SVG_NS = "http://www.w3.org/2000/svg";

const objectValue = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
};

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const stringValue = (value, fallback = "") => value == null ? fallback : String(value);

const freezeArray = (value) => Object.freeze(value);

const portOffset = (node, port, ports) => {
  const directional = ports.filter((entry) => entry.direction === port.direction);
  const index = Math.max(0, directional.findIndex((entry) => entry.id === port.id));
  const y = node.height * ((index + 1) / (directional.length + 1));
  return Object.freeze({
    x: port.direction === "in" ? 0 : node.width,
    y,
  });
};

const pathFor = (from, to) => {
  const distance = Math.max(40, Math.abs(to.x - from.x) * 0.5);
  const first = from.x + distance;
  const second = to.x - distance;
  return `M ${from.x} ${from.y} C ${first} ${from.y}, ${second} ${to.y}, ${to.x} ${to.y}`;
};

/**
 * Projects the normalized Hodos Graph model into an inert DOM/SVG render plan.
 * Node metadata remains descriptive and is never evaluated by the host.
 */
export function projectGraphDomView(model) {
  const input = objectValue(model, "Hodos 2D Graph DOM model");
  const graph = objectValue(input.graph, "Hodos 2D Graph DOM graph");
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const minX = rawNodes.length ? Math.min(...rawNodes.map((node) => finite(node.x))) : 0;
  const minY = rawNodes.length ? Math.min(...rawNodes.map((node) => finite(node.y))) : 0;
  const offsetX = 80 - Math.min(0, minX);
  const offsetY = 70 - Math.min(0, minY);

  const nodes = rawNodes.map((rawNode) => {
    const node = objectValue(rawNode, "Hodos 2D Graph DOM node");
    const ports = (node.ports ?? []).map((rawPort) => {
      const port = objectValue(rawPort, "Hodos 2D Graph DOM port");
      return Object.freeze({
        id: stringValue(port.id),
        direction: stringValue(port.direction),
        dataType: port.dataType == null ? null : String(port.dataType),
        label: port.label == null ? null : String(port.label),
      });
    });
    const projected = {
      id: stringValue(node.id),
      type: stringValue(node.type),
      label: stringValue(node.label, stringValue(node.type, "Node")),
      x: finite(node.x),
      y: finite(node.y),
      width: Math.max(80, finite(node.width, 160)),
      height: Math.max(56, finite(node.height, 80)),
      readOnly: Boolean(node.readOnly),
      metadata: node.metadata ?? {},
      ports: null,
    };
    projected.ports = freezeArray(ports.map((port) => Object.freeze({
      ...port,
      offset: portOffset(projected, port, ports),
    })));
    return Object.freeze(projected);
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const portByKey = new Map();
  for (const node of nodes) {
    for (const port of node.ports) portByKey.set(`${node.id}/${port.id}`, { node, port });
  }

  const selectedNodes = new Set(input.selection?.nodeIds ?? []);
  const selectedConnections = new Set(input.selection?.connectionIds ?? []);
  const connections = (graph.connections ?? []).map((rawConnection) => {
    const connection = objectValue(rawConnection, "Hodos 2D Graph DOM connection");
    const from = objectValue(connection.from, "Hodos 2D Graph DOM source endpoint");
    const to = objectValue(connection.to, "Hodos 2D Graph DOM target endpoint");
    const source = portByKey.get(`${from.nodeId}/${from.portId}`);
    const target = portByKey.get(`${to.nodeId}/${to.portId}`);
    if (!source || !target) throw new Error(`Hodos 2D Graph DOM connection endpoint is missing: ${connection.id}`);
    const fromPoint = {
      x: source.node.x + source.port.offset.x + offsetX,
      y: source.node.y + source.port.offset.y + offsetY,
    };
    const toPoint = {
      x: target.node.x + target.port.offset.x + offsetX,
      y: target.node.y + target.port.offset.y + offsetY,
    };
    return Object.freeze({
      id: stringValue(connection.id),
      type: connection.type == null ? null : String(connection.type),
      from: Object.freeze({ nodeId: String(from.nodeId), portId: String(from.portId) }),
      to: Object.freeze({ nodeId: String(to.nodeId), portId: String(to.portId) }),
      path: pathFor(fromPoint, toPoint),
      selected: selectedConnections.has(String(connection.id)),
      metadata: connection.metadata ?? {},
    });
  });

  const maximumX = nodes.length
    ? Math.max(...nodes.map((node) => node.x + node.width + offsetX))
    : 0;
  const maximumY = nodes.length
    ? Math.max(...nodes.map((node) => node.y + node.height + offsetY))
    : 0;
  const capabilities = input.capabilities && typeof input.capabilities === "object"
    ? input.capabilities
    : {};

  return Object.freeze({
    id: stringValue(graph.id),
    revision: finite(graph.revision, 0),
    status: stringValue(input.status, "ready"),
    readOnly: Boolean(input.readOnly),
    error: input.error == null ? null : String(input.error),
    metadata: graph.metadata ?? {},
    offset: Object.freeze({ x: offsetX, y: offsetY }),
    width: Math.max(800, maximumX + 160),
    height: Math.max(520, maximumY + 140),
    viewport: Object.freeze({
      x: finite(input.viewport?.x),
      y: finite(input.viewport?.y),
      zoom: Math.max(0.05, finite(input.viewport?.zoom, 1)),
    }),
    capabilities: Object.freeze({
      select: Boolean(capabilities.select),
      moveNode: Boolean(capabilities.moveNode),
      connect: Boolean(capabilities.connect),
      createNode: Boolean(capabilities.createNode),
      delete: Boolean(capabilities.delete),
      command: Boolean(capabilities.command),
    }),
    selection: Object.freeze({
      nodeIds: freezeArray([...selectedNodes].map(String)),
      connectionIds: freezeArray([...selectedConnections].map(String)),
    }),
    nodes: freezeArray(nodes.map((node) => Object.freeze({
      ...node,
      sceneX: node.x + offsetX,
      sceneY: node.y + offsetY,
      selected: selectedNodes.has(node.id),
    }))),
    connections: freezeArray(connections),
    counts: Object.freeze({
      nodes: nodes.length,
      connections: connections.length,
    }),
    nodeById,
  });
}

const domDocument = (container) => {
  const document = container?.ownerDocument ?? globalThis.document;
  if (!document || typeof document.createElement !== "function") {
    throw new Error("Hodos 2D Graph DOM host requires a DOM Document");
  }
  return document;
};

const addListener = (target, type, listener, controller) => {
  try {
    target.addEventListener(type, listener, { signal: controller.signal });
  } catch {
    target.addEventListener(type, listener);
    controller.signal.addEventListener("abort", () => target.removeEventListener(type, listener), {
      once: true,
    });
  }
};

const className = (node, value) => {
  node.className = value;
  return node;
};

const textElement = (document, tag, text, value = {}) => {
  const node = document.createElement(tag);
  node.textContent = text;
  if (value.className) node.className = value.className;
  return node;
};

const button = (document, label, action, controller, disabled = false) => {
  const node = className(document.createElement("button"), "hodos-2d-graph-button");
  node.type = "button";
  node.textContent = label;
  node.disabled = disabled;
  addListener(node, "click", (event) => {
    event.stopPropagation?.();
    action(event);
  }, controller);
  return node;
};

const toggled = (values, id, additive) => {
  if (!additive) return [id];
  const set = new Set(values);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return [...set];
};

export function createGraphDomHost({
  container,
  dispatch = () => {},
  services = {},
  reportError = null,
} = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Hodos 2D Graph DOM host requires a container element");
  }

  const document = domDocument(container);
  const errorReporter = reportError
    ?? services?.graph?.reportError
    ?? services?.reportError
    ?? (() => {});
  let controller = null;
  let disposed = false;
  let pendingPort = null;
  let pendingElement = null;

  const report = (error) => {
    try {
      errorReporter(error);
    } catch {
      // Reporting must not create a second graph failure.
    }
  };

  const send = (type, detail = {}) => {
    try {
      const result = dispatch({ "event/type": type, ...detail });
      if (result && typeof result.then === "function") result.catch(report);
    } catch (error) {
      report(error);
    }
  };

  const resetRender = () => {
    controller?.abort();
    controller = new AbortController();
    pendingPort = null;
    pendingElement = null;
  };

  const render = (model) => {
    if (disposed) throw new Error("Hodos 2D Graph DOM host has been disposed");
    const view = projectGraphDomView(model);
    resetRender();

    container.classList?.add("hodos-2d-graph-host");
    container.dataset.hodosComponent = "hodos.2d/graph";
    container.dataset.graphId = view.id;
    container.dataset.graphStatus = view.status;

    const shell = className(document.createElement("section"), "hodos-2d-graph");
    const toolbar = className(document.createElement("header"), "hodos-2d-graph-toolbar");
    const identity = document.createElement("div");
    identity.append(
      textElement(document, "strong", stringValue(view.metadata.title, "Graph")),
      textElement(document, "span", `revision ${view.revision} · ${view.status}`),
    );
    const actions = className(document.createElement("nav"), "hodos-2d-graph-actions");
    actions.setAttribute("aria-label", "Graph actions");
    if (view.capabilities.createNode) {
      actions.append(button(document, "New node", () => send("graph/create-node", {
        graphId: view.id,
        nodeType: "node",
        x: Math.max(0, (view.width * 0.5 - view.offset.x - view.viewport.x) / view.viewport.zoom),
        y: Math.max(0, (view.height * 0.5 - view.offset.y - view.viewport.y) / view.viewport.zoom),
      }), controller, view.readOnly));
    }
    if (view.capabilities.delete) {
      actions.append(button(document, "Delete selection", () => send("graph/delete", {
        graphId: view.id,
        nodeIds: view.selection.nodeIds,
        connectionIds: view.selection.connectionIds,
      }), controller, view.readOnly || (!view.selection.nodeIds.length && !view.selection.connectionIds.length)));
    }
    if (view.capabilities.command) {
      actions.append(button(document, "Commands", () => send("graph/command", {
        graphId: view.id,
        command: "graph/commands",
      }), controller));
    }
    toolbar.append(identity, actions);

    const viewport = className(document.createElement("main"), "hodos-2d-graph-viewport");
    viewport.dataset.graphViewport = view.id;
    const world = className(document.createElement("div"), "hodos-2d-graph-world");
    world.style.width = `${view.width}px`;
    world.style.height = `${view.height}px`;
    world.style.transform = `translate(${view.viewport.x}px, ${view.viewport.y}px) scale(${view.viewport.zoom})`;

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "hodos-2d-graph-connections");
    svg.setAttribute("viewBox", `0 0 ${view.width} ${view.height}`);
    svg.setAttribute("aria-hidden", "true");

    const nodeCoordinates = new Map(view.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
    const nodeById = new Map(view.nodes.map((node) => [node.id, node]));
    const pathElements = new Map();
    const connectionById = new Map(view.connections.map((connection) => [connection.id, connection]));

    const pointFor = (endpoint) => {
      const node = nodeById.get(endpoint.nodeId);
      const coordinates = nodeCoordinates.get(endpoint.nodeId);
      const port = node?.ports.find((entry) => entry.id === endpoint.portId);
      if (!node || !coordinates || !port) throw new Error(`Graph endpoint disappeared: ${endpoint.nodeId}/${endpoint.portId}`);
      return {
        x: coordinates.x + port.offset.x + view.offset.x,
        y: coordinates.y + port.offset.y + view.offset.y,
      };
    };

    const updateConnection = (connection) => {
      const path = pathElements.get(connection.id);
      if (!path) return;
      path.setAttribute("d", pathFor(pointFor(connection.from), pointFor(connection.to)));
    };

    const updateNodeConnections = (nodeId) => {
      for (const connection of view.connections) {
        if (connection.from.nodeId === nodeId || connection.to.nodeId === nodeId) updateConnection(connection);
      }
    };

    for (const connection of view.connections) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("class", `hodos-2d-graph-connection${connection.selected ? " selected" : ""}`);
      path.dataset.connectionId = connection.id;
      path.setAttribute("d", connection.path);
      addListener(path, "click", (event) => {
        event.stopPropagation?.();
        if (!view.capabilities.select) return;
        send("graph/select", {
          graphId: view.id,
          nodeIds: event.shiftKey ? view.selection.nodeIds : [],
          connectionIds: toggled(view.selection.connectionIds, connection.id, Boolean(event.shiftKey)),
        });
      }, controller);
      pathElements.set(connection.id, path);
      svg.append(path);
    }

    addListener(viewport, "click", (event) => {
      if (event.target !== viewport && event.target !== world && event.target !== svg) return;
      if (!view.capabilities.select) return;
      send("graph/select", { graphId: view.id, nodeIds: [], connectionIds: [] });
    }, controller);

    world.append(svg);

    const setPendingPort = (next, element) => {
      pendingElement?.classList?.remove("pending");
      pendingPort = next;
      pendingElement = element;
      pendingElement?.classList?.add("pending");
    };

    for (const node of view.nodes) {
      const element = className(
        document.createElement("article"),
        `hodos-2d-graph-node${node.selected ? " selected" : ""}`,
      );
      element.dataset.nodeId = node.id;
      element.dataset.nodeType = node.type;
      element.style.left = `${node.sceneX}px`;
      element.style.top = `${node.sceneY}px`;
      element.style.width = `${node.width}px`;
      element.style.height = `${node.height}px`;

      const header = className(document.createElement("header"), "hodos-2d-graph-node-header");
      header.dataset.graphDragHandle = node.id;
      header.append(
        textElement(document, "strong", node.label),
        textElement(document, "small", node.type),
      );
      const body = className(document.createElement("div"), "hodos-2d-graph-node-body");
      body.append(textElement(
        document,
        "p",
        stringValue(node.metadata.description, `${node.ports.length} ports`),
      ));
      element.append(header, body);

      const selectNode = (event) => {
        if (!view.capabilities.select) return;
        send("graph/select", {
          graphId: view.id,
          nodeIds: toggled(view.selection.nodeIds, node.id, Boolean(event?.shiftKey)),
          connectionIds: event?.shiftKey ? view.selection.connectionIds : [],
        });
      };

      let drag = null;
      addListener(header, "pointerdown", (event) => {
        if (event.button != null && event.button !== 0) return;
        event.stopPropagation?.();
        selectNode(event);
        if (view.readOnly || node.readOnly || !view.capabilities.moveNode) return;
        event.preventDefault?.();
        header.setPointerCapture?.(event.pointerId);
        header.classList?.add("dragging");
        drag = {
          pointerId: event.pointerId,
          clientX: finite(event.clientX),
          clientY: finite(event.clientY),
          x: nodeCoordinates.get(node.id).x,
          y: nodeCoordinates.get(node.id).y,
          moved: false,
        };
      }, controller);

      addListener(header, "pointermove", (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const x = drag.x + (finite(event.clientX) - drag.clientX) / view.viewport.zoom;
        const y = drag.y + (finite(event.clientY) - drag.clientY) / view.viewport.zoom;
        drag.moved = drag.moved || x !== drag.x || y !== drag.y;
        nodeCoordinates.set(node.id, { x, y });
        element.style.left = `${x + view.offset.x}px`;
        element.style.top = `${y + view.offset.y}px`;
        updateNodeConnections(node.id);
      }, controller);

      const finishDrag = (event, cancelled = false) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        header.releasePointerCapture?.(event.pointerId);
        header.classList?.remove("dragging");
        const completed = drag;
        drag = null;
        if (cancelled) {
          nodeCoordinates.set(node.id, { x: completed.x, y: completed.y });
          element.style.left = `${completed.x + view.offset.x}px`;
          element.style.top = `${completed.y + view.offset.y}px`;
          updateNodeConnections(node.id);
          return;
        }
        const coordinates = nodeCoordinates.get(node.id);
        if (completed.moved && coordinates) {
          send("graph/move-node", {
            graphId: view.id,
            nodeId: node.id,
            x: coordinates.x,
            y: coordinates.y,
          });
        }
      };
      addListener(header, "pointerup", (event) => finishDrag(event), controller);
      addListener(header, "pointercancel", (event) => finishDrag(event, true), controller);

      for (const port of node.ports) {
        const portElement = className(
          document.createElement("button"),
          `hodos-2d-graph-port ${port.direction}`,
        );
        portElement.type = "button";
        portElement.dataset.nodeId = node.id;
        portElement.dataset.portId = port.id;
        portElement.dataset.portDirection = port.direction;
        portElement.style.top = `${port.offset.y}px`;
        portElement.title = `${port.label || port.id}${port.dataType ? ` · ${port.dataType}` : ""}`;
        portElement.disabled = view.readOnly || !view.capabilities.connect;
        addListener(portElement, "click", (event) => {
          event.stopPropagation?.();
          if (portElement.disabled) return;
          if (port.direction === "out") {
            setPendingPort({ nodeId: node.id, portId: port.id }, portElement);
            return;
          }
          if (!pendingPort) return;
          send("graph/connect", {
            graphId: view.id,
            from: pendingPort,
            to: { nodeId: node.id, portId: port.id },
          });
          setPendingPort(null, null);
        }, controller);
        const label = className(
          textElement(document, "span", port.label || port.id),
          `hodos-2d-graph-port-label ${port.direction}`,
        );
        label.style.top = `${port.offset.y}px`;
        element.append(portElement, label);
      }

      world.append(element);
    }

    viewport.append(world);
    const footer = className(document.createElement("footer"), "hodos-2d-graph-footer");
    footer.append(
      textElement(document, "span", `${view.counts.nodes} nodes · ${view.counts.connections} connections`),
      textElement(document, "span", view.readOnly ? "Read only" : `Zoom ${view.viewport.zoom.toFixed(2)}`),
    );

    shell.append(toolbar, viewport);
    if (view.error) {
      shell.append(textElement(document, "p", view.error, { className: "hodos-2d-graph-error" }));
    }
    shell.append(footer);
    container.replaceChildren(shell);
  };

  return {
    update(model) {
      render(model);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      controller?.abort();
      container.replaceChildren();
      container.classList?.remove("hodos-2d-graph-host");
      delete container.dataset.hodosComponent;
      delete container.dataset.graphId;
      delete container.dataset.graphStatus;
    },
  };
}

export const createHodosGraphDomHost = createGraphDomHost;
