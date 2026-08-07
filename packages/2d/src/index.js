import { WORKSPACE_COMPONENT_CONTRACT } from "@greenways/hodos-web";

const nonEmptyString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
};

const optionalString = (value, label) => value == null ? null : nonEmptyString(value, label);

const booleanValue = (value, fallback, label) => {
  if (value == null) return fallback;
  if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
  return value;
};

const integerValue = (value, fallback, label, { minimum = 0 } = {}) => {
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw new TypeError(`${label} must be an integer greater than or equal to ${minimum}`);
  }
  return number;
};

const finiteNumber = (value, fallback, label) => {
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be a finite number`);
  return number;
};

const positiveNumber = (value, fallback, label) => {
  const number = finiteNumber(value, fallback, label);
  if (number <= 0) throw new TypeError(`${label} must be greater than zero`);
  return number;
};

const plainObject = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
};

const serializableValue = (value, label, ancestors = new Set()) => {
  if (value == null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${label} numbers must be finite`);
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${label} must contain only serializable values`);
  }
  if (ancestors.has(value)) throw new TypeError(`${label} must not contain cycles`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((entry, index) =>
        serializableValue(entry, `${label}[${index}]`, ancestors)));
    }
    const input = plainObject(value, label);
    const output = {};
    for (const [key, entry] of Object.entries(input)) {
      Object.defineProperty(output, key, {
        value: serializableValue(entry, `${label}.${key}`, ancestors),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(output);
  } finally {
    ancestors.delete(value);
  }
};

const uniqueStrings = (value = [], label) => {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return Object.freeze([...new Set(value.map((entry, index) =>
    nonEmptyString(entry, `${label} ${index}`)))].sort());
};

const capabilityValue = (value, keys, label) => {
  const input = value == null ? {} : plainObject(value, label);
  const output = {};
  for (const key of keys) {
    output[key] = booleanValue(input[key], false, `${label} ${key}`);
  }
  return Object.freeze(output);
};

export const HODOS_2D_DOCUMENT_PROFILE = "hodos.rich-text/2";
export const HODOS_2D_DOCUMENT_AREA_TYPE = "hodos.2d/document";
export const HODOS_2D_DOCUMENT_COMPONENT_ID = "hodos.2d/document";
export const HODOS_2D_DOCUMENT_EVENTS = Object.freeze([
  "document/select",
  "document/edit-text",
  "document/insert-block",
  "document/delete-block",
  "document/activate-artefact",
  "document/commit-artefact",
  "document/command",
]);

export const HODOS_2D_DOCUMENT_BLOCK_TYPES = Object.freeze([
  "paragraph",
  "heading",
  "blockquote",
  "bullet-list",
  "ordered-list",
  "list-item",
  "code-block",
  "horizontal-rule",
  "hara-artefact",
]);

export const HODOS_2D_ARTEFACT_KINDS = Object.freeze([
  "value",
  "view",
  "table",
  "chart",
  "canvas",
  "query",
  "agent",
  "custom",
]);

const DOCUMENT_BLOCK_TYPES = new Set(HODOS_2D_DOCUMENT_BLOCK_TYPES);
const ARTEFACT_KINDS = new Set(HODOS_2D_ARTEFACT_KINDS);
const DOCUMENT_STATUSES = new Set(["idle", "ready", "saving", "error"]);
const ARTEFACT_MODES = new Set(["live", "snapshot"]);

const textNodeValue = (node, label, ids) => {
  const input = plainObject(node, label);
  const id = nonEmptyString(input.id, `${label} id`);
  if (ids.has(id)) throw new Error(`Duplicate Hodos 2D document node id: ${id}`);
  ids.add(id);
  if ((input.type ?? "text") !== "text") throw new Error(`${label} must have type text`);
  if (typeof (input.text ?? "") !== "string") throw new TypeError(`${label} text must be a string`);
  return Object.freeze({
    id,
    type: "text",
    text: input.text ?? "",
    marks: serializableValue(input.marks ?? [], `${label} marks`),
  });
};

const artefactAttrsValue = (value, label) => {
  const input = plainObject(value ?? {}, label);
  const kind = nonEmptyString(input.kind ?? "value", `${label} kind`);
  if (!ARTEFACT_KINDS.has(kind)) throw new Error(`${label} has unsupported kind: ${kind}`);
  const mode = nonEmptyString(input.mode ?? "live", `${label} mode`);
  if (!ARTEFACT_MODES.has(mode)) throw new Error(`${label} has unsupported mode: ${mode}`);
  return Object.freeze({
    artefactId: nonEmptyString(input.artefactId, `${label} artefact id`),
    kind,
    title: optionalString(input.title, `${label} title`) ?? "Hara artefact",
    mode,
    entry: optionalString(input.entry, `${label} entry`),
    capabilities: uniqueStrings(input.capabilities ?? [], `${label} capabilities`),
    snapshotRoot: optionalString(input.snapshotRoot, `${label} snapshot root`),
    snapshotDisplay: input.snapshotDisplay == null
      ? null
      : String(input.snapshotDisplay),
    snapshotMediaType: optionalString(input.snapshotMediaType, `${label} snapshot media type`),
    snapshotSourceRoot: optionalString(input.snapshotSourceRoot, `${label} snapshot source root`),
    metadata: serializableValue(input.metadata ?? {}, `${label} metadata`),
  });
};

const blockValue = (node, index, ids, label = "Hodos 2D document block") => {
  const input = plainObject(node, `${label} ${index}`);
  const id = nonEmptyString(input.id, `${label} ${index} id`);
  if (ids.has(id)) throw new Error(`Duplicate Hodos 2D document node id: ${id}`);
  ids.add(id);
  const type = nonEmptyString(input.type, `${label} ${index} type`);
  if (!DOCUMENT_BLOCK_TYPES.has(type)) throw new Error(`${label} ${index} has unsupported type: ${type}`);

  const rawChildren = input.children ?? [];
  if (!Array.isArray(rawChildren)) throw new TypeError(`${label} ${index} children must be an array`);
  if (type !== "horizontal-rule" && !rawChildren.length) {
    throw new Error(`${label} ${index} must contain at least one child`);
  }

  const children = rawChildren.map((child, childIndex) => {
    if (child?.type === "text") {
      return textNodeValue(child, `${label} ${index} text ${childIndex}`, ids);
    }
    return blockValue(child, childIndex, ids, `${label} ${index} child`);
  });

  if (type === "heading") {
    const level = integerValue(input.attrs?.level, 1, `${label} ${index} heading level`, { minimum: 1 });
    if (level > 6) throw new TypeError(`${label} ${index} heading level must be between 1 and 6`);
  }

  let attrs;
  if (type === "hara-artefact") {
    attrs = artefactAttrsValue(input.attrs, `${label} ${index} artefact`);
    if (!children.some((child) => child.type === "text")) {
      throw new Error(`${label} ${index} artefact requires a source text child`);
    }
  } else {
    const rawAttrs = input.attrs ?? {};
    attrs = serializableValue(rawAttrs, `${label} ${index} attrs`);
    if (type === "heading") attrs = Object.freeze({ ...attrs, level: Number(rawAttrs.level ?? 1) });
  }

  return Object.freeze({ id, type, attrs, children: Object.freeze(children) });
};

export function normalizeRichDocument(value, label = "Hodos 2D document") {
  const input = plainObject(value, label);
  const profile = nonEmptyString(input.profile ?? HODOS_2D_DOCUMENT_PROFILE, `${label} profile`);
  if (profile !== HODOS_2D_DOCUMENT_PROFILE) {
    throw new Error(`${label} has unsupported profile: ${profile}`);
  }
  if (!Array.isArray(input.children)) throw new TypeError(`${label} children must be an array`);
  const ids = new Set();
  const id = nonEmptyString(input.id, `${label} id`);
  ids.add(id);
  return Object.freeze({
    profile,
    id,
    title: optionalString(input.title, `${label} title`) ?? "Untitled document",
    revision: integerValue(input.revision, 0, `${label} revision`),
    metadata: serializableValue(input.metadata ?? {}, `${label} metadata`),
    children: Object.freeze(input.children.map((block, index) => blockValue(block, index, ids))),
  });
}

const documentPointValue = (value, label) => {
  if (value == null) return null;
  const input = plainObject(value, label);
  return Object.freeze({
    textId: nonEmptyString(input.textId, `${label} text id`),
    offset: integerValue(input.offset, 0, `${label} offset`),
  });
};

const documentSelectionValue = (value, label = "Hodos 2D document selection") => {
  if (value == null) return Object.freeze({ nodeId: null, anchor: null, focus: null });
  const input = plainObject(value, label);
  return Object.freeze({
    nodeId: optionalString(input.nodeId, `${label} node id`),
    anchor: documentPointValue(input.anchor, `${label} anchor`),
    focus: documentPointValue(input.focus ?? input.anchor, `${label} focus`),
  });
};

const documentCapabilitiesValue = (value) => capabilityValue(value, [
  "select",
  "editText",
  "insertBlock",
  "deleteBlock",
  "activateArtefact",
  "commitArtefact",
  "command",
], "Hodos 2D document capabilities");

export function createDocumentArea({
  id = "document/main",
  title = "Document",
  document,
  selection = null,
  status = "ready",
  readOnly = false,
  capabilities = {},
  error = null,
  events = HODOS_2D_DOCUMENT_EVENTS,
} = {}) {
  id = nonEmptyString(id, "Hodos 2D Document area id");
  title = nonEmptyString(title, "Hodos 2D Document title");
  status = nonEmptyString(status, "Hodos 2D Document status");
  if (!DOCUMENT_STATUSES.has(status)) throw new Error(`Unsupported Hodos 2D Document status: ${status}`);
  if (!Array.isArray(events)) throw new TypeError("Hodos 2D Document events must be an array");
  const model = Object.freeze({
    document: normalizeRichDocument(document),
    selection: documentSelectionValue(selection),
    status,
    readOnly: booleanValue(readOnly, false, "Hodos 2D Document readOnly"),
    capabilities: documentCapabilitiesValue(capabilities),
    error: error == null ? null : String(error),
  });
  return Object.freeze({
    "area/id": id,
    "area/type": HODOS_2D_DOCUMENT_AREA_TYPE,
    "area/title": title,
    "area/component": Object.freeze({
      "component/id": HODOS_2D_DOCUMENT_COMPONENT_ID,
      "component/contract": WORKSPACE_COMPONENT_CONTRACT,
      "component/model": model,
      "component/events": Object.freeze([...events]),
    }),
  });
}

export const HODOS_2D_GRAPH_AREA_TYPE = "hodos.2d/graph";
export const HODOS_2D_GRAPH_COMPONENT_ID = "hodos.2d/graph";
export const HODOS_2D_GRAPH_EVENTS = Object.freeze([
  "graph/select",
  "graph/move-node",
  "graph/connect",
  "graph/create-node",
  "graph/delete",
  "graph/command",
]);

const GRAPH_PORT_DIRECTIONS = new Set(["in", "out"]);
const GRAPH_STATUSES = new Set(["idle", "ready", "saving", "error"]);

const graphPortValue = (value, index, nodeId) => {
  const label = `Hodos 2D Graph node ${nodeId} port ${index}`;
  const input = plainObject(value, label);
  const direction = nonEmptyString(input.direction, `${label} direction`);
  if (!GRAPH_PORT_DIRECTIONS.has(direction)) throw new Error(`${label} has unsupported direction: ${direction}`);
  return Object.freeze({
    id: nonEmptyString(input.id, `${label} id`),
    direction,
    dataType: optionalString(input.dataType ?? input.type, `${label} data type`),
    label: optionalString(input.label, `${label} label`),
    metadata: serializableValue(input.metadata ?? {}, `${label} metadata`),
  });
};

const graphNodeValue = (value, index) => {
  const label = `Hodos 2D Graph node ${index}`;
  const input = plainObject(value, label);
  const id = nonEmptyString(input.id, `${label} id`);
  if (!Array.isArray(input.ports ?? [])) throw new TypeError(`${label} ports must be an array`);
  const ports = (input.ports ?? []).map((port, portIndex) => graphPortValue(port, portIndex, id));
  const portIds = new Set();
  for (const port of ports) {
    if (portIds.has(port.id)) throw new Error(`${label} has duplicate port id: ${port.id}`);
    portIds.add(port.id);
  }
  return Object.freeze({
    id,
    type: nonEmptyString(input.type, `${label} type`),
    label: optionalString(input.label, `${label} label`) ?? input.type,
    x: finiteNumber(input.x, 0, `${label} x`),
    y: finiteNumber(input.y, 0, `${label} y`),
    width: positiveNumber(input.width, 160, `${label} width`),
    height: positiveNumber(input.height, 80, `${label} height`),
    ports: Object.freeze(ports),
    readOnly: booleanValue(input.readOnly, false, `${label} readOnly`),
    metadata: serializableValue(input.metadata ?? {}, `${label} metadata`),
  });
};

const endpointFromString = (value, label) => {
  const parts = nonEmptyString(value, label).split(":");
  if (parts.length < 3) throw new TypeError(`${label} must contain node, direction and port index`);
  const index = parts.pop();
  const direction = parts.pop();
  return { nodeId: parts.join(":"), portId: `${direction}:${index}` };
};

const graphEndpointValue = (value, label) => {
  const input = typeof value === "string" ? endpointFromString(value, label) : plainObject(value, label);
  return Object.freeze({
    nodeId: nonEmptyString(input.nodeId, `${label} node id`),
    portId: nonEmptyString(input.portId, `${label} port id`),
  });
};

const graphConnectionValue = (value, index, nodeById) => {
  const label = `Hodos 2D Graph connection ${index}`;
  const input = plainObject(value, label);
  const from = graphEndpointValue(input.from, `${label} from`);
  const to = graphEndpointValue(input.to, `${label} to`);
  const fromNode = nodeById.get(from.nodeId);
  const toNode = nodeById.get(to.nodeId);
  if (!fromNode) throw new Error(`${label} references missing source node: ${from.nodeId}`);
  if (!toNode) throw new Error(`${label} references missing target node: ${to.nodeId}`);
  const fromPort = fromNode.ports.find((port) => port.id === from.portId);
  const toPort = toNode.ports.find((port) => port.id === to.portId);
  if (!fromPort) throw new Error(`${label} references missing source port: ${from.nodeId}/${from.portId}`);
  if (!toPort) throw new Error(`${label} references missing target port: ${to.nodeId}/${to.portId}`);
  if (fromPort.direction !== "out" || toPort.direction !== "in") {
    throw new Error(`${label} must connect an out port to an in port`);
  }
  if (fromPort.dataType && toPort.dataType && fromPort.dataType !== toPort.dataType) {
    throw new Error(`${label} has incompatible port types: ${fromPort.dataType} -> ${toPort.dataType}`);
  }
  return Object.freeze({
    id: nonEmptyString(input.id, `${label} id`),
    from,
    to,
    type: optionalString(input.type, `${label} type`),
    metadata: serializableValue(input.metadata ?? {}, `${label} metadata`),
  });
};

const graphSelectionValue = (value, nodeIds, connectionIds) => {
  const input = value == null ? {} : plainObject(value, "Hodos 2D Graph selection");
  const selectedNodes = uniqueStrings(input.nodeIds ?? [], "Hodos 2D Graph selected node ids");
  const selectedConnections = uniqueStrings(
    input.connectionIds ?? [],
    "Hodos 2D Graph selected connection ids",
  );
  for (const id of selectedNodes) if (!nodeIds.has(id)) throw new Error(`Selected Hodos 2D Graph node is missing: ${id}`);
  for (const id of selectedConnections) {
    if (!connectionIds.has(id)) throw new Error(`Selected Hodos 2D Graph connection is missing: ${id}`);
  }
  return Object.freeze({ nodeIds: selectedNodes, connectionIds: selectedConnections });
};

const graphViewportValue = (value) => {
  const input = value == null ? {} : plainObject(value, "Hodos 2D Graph viewport");
  const zoom = positiveNumber(input.zoom, 1, "Hodos 2D Graph viewport zoom");
  return Object.freeze({
    x: finiteNumber(input.x, 0, "Hodos 2D Graph viewport x"),
    y: finiteNumber(input.y, 0, "Hodos 2D Graph viewport y"),
    zoom,
  });
};

const graphCapabilitiesValue = (value) => capabilityValue(value, [
  "select",
  "moveNode",
  "connect",
  "createNode",
  "delete",
  "command",
], "Hodos 2D Graph capabilities");

export function normalizeGraph(value, label = "Hodos 2D Graph") {
  const input = plainObject(value, label);
  if (!Array.isArray(input.nodes ?? [])) throw new TypeError(`${label} nodes must be an array`);
  if (!Array.isArray(input.connections ?? [])) throw new TypeError(`${label} connections must be an array`);
  const nodes = (input.nodes ?? []).map(graphNodeValue);
  const nodeById = new Map();
  for (const node of nodes) {
    if (nodeById.has(node.id)) throw new Error(`Duplicate Hodos 2D Graph node id: ${node.id}`);
    nodeById.set(node.id, node);
  }
  const connections = (input.connections ?? []).map((connection, index) =>
    graphConnectionValue(connection, index, nodeById));
  const connectionIds = new Set();
  for (const connection of connections) {
    if (connectionIds.has(connection.id)) throw new Error(`Duplicate Hodos 2D Graph connection id: ${connection.id}`);
    connectionIds.add(connection.id);
  }
  return Object.freeze({
    id: nonEmptyString(input.id, `${label} id`),
    revision: integerValue(input.revision, 0, `${label} revision`),
    nodes: Object.freeze(nodes),
    connections: Object.freeze(connections),
    metadata: serializableValue(input.metadata ?? {}, `${label} metadata`),
  });
}

export function createGraphArea({
  id = "graph/main",
  title = "Graph",
  graph,
  selection = null,
  viewport = null,
  status = "ready",
  readOnly = false,
  capabilities = {},
  error = null,
  events = HODOS_2D_GRAPH_EVENTS,
} = {}) {
  id = nonEmptyString(id, "Hodos 2D Graph area id");
  title = nonEmptyString(title, "Hodos 2D Graph title");
  status = nonEmptyString(status, "Hodos 2D Graph status");
  if (!GRAPH_STATUSES.has(status)) throw new Error(`Unsupported Hodos 2D Graph status: ${status}`);
  if (!Array.isArray(events)) throw new TypeError("Hodos 2D Graph events must be an array");
  const normalized = normalizeGraph(graph);
  const model = Object.freeze({
    graph: normalized,
    selection: graphSelectionValue(
      selection,
      new Set(normalized.nodes.map((node) => node.id)),
      new Set(normalized.connections.map((connection) => connection.id)),
    ),
    viewport: graphViewportValue(viewport),
    status,
    readOnly: booleanValue(readOnly, false, "Hodos 2D Graph readOnly"),
    capabilities: graphCapabilitiesValue(capabilities),
    counts: Object.freeze({
      nodes: normalized.nodes.length,
      connections: normalized.connections.length,
    }),
    error: error == null ? null : String(error),
  });
  return Object.freeze({
    "area/id": id,
    "area/type": HODOS_2D_GRAPH_AREA_TYPE,
    "area/title": title,
    "area/component": Object.freeze({
      "component/id": HODOS_2D_GRAPH_COMPONENT_ID,
      "component/contract": WORKSPACE_COMPONENT_CONTRACT,
      "component/model": model,
      "component/events": Object.freeze([...events]),
    }),
  });
}
