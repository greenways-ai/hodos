import { normalizeGraph } from "./index.js";

export const WORK_RECIPE_SCHEMA = "std.work.recipe/0-alpha";
export const WORK_RECIPE_GRAPH_SCHEMA = "hodos.work-recipe-graph/0-alpha";
export const WORK_RECIPE_NODE_SCHEMA = "hodos.work-recipe-node/0-alpha";
export const WORK_RECIPE_EDGE_SCHEMA = "hodos.work-recipe-edge/0-alpha";
export const WORK_RUN_SCHEMA = "hodos.work-run/0-alpha";
export const WORK_RUN_OVERLAY_SCHEMA = "hodos.work-run-overlay/0-alpha";

export const WORK_RECIPE_LEAF_OPERATIONS = Object.freeze(["pure-ref", "step-ref"]);
export const WORK_RECIPE_COLLECTION_OPERATIONS = Object.freeze(["each", "filter", "fold"]);
export const WORK_RECIPE_COMPOSITE_OPERATIONS = Object.freeze([
  "chain", "all", "choose", "batch", "ensure",
]);
export const WORK_RECIPE_OPERATIONS = Object.freeze([
  ...WORK_RECIPE_LEAF_OPERATIONS,
  ...WORK_RECIPE_COLLECTION_OPERATIONS,
  ...WORK_RECIPE_COMPOSITE_OPERATIONS,
]);

const SUPPORTED_OPERATIONS = new Set(WORK_RECIPE_OPERATIONS);
const LEAF_OPERATIONS = new Set(WORK_RECIPE_LEAF_OPERATIONS);
const RUN_STATUSES = new Set([
  "created", "queued", "running", "waiting", "completed", "failed", "cancelled",
]);
const RUN_NODE_STATUSES = new Set([
  "pending", "queued", "running", "waiting", "completed", "failed", "cancelled", "skipped",
]);
const RECEIPT_STATUSES = new Set(["none", "pending", "published", "rejected"]);
const STRUCTURAL_KEYS = new Set([
  "children", "work", "selector", "choices", "list", "filter", "process", "summarise", "cleanup",
]);
const SEMANTIC_KEYS = Object.freeze([
  "op", "id", "uses", "params", "retry", "initial", "return", "definition-digest", "input-digest",
]);
const DEFAULT_NODE_WIDTH = 216;
const DEFAULT_NODE_HEIGHT = 104;
const DEFAULT_COLUMN_GAP = 72;
const DEFAULT_ROW_GAP = 42;
const MAX_RECIPE_NODES = 4096;
const MAX_RUN_NODES = 4096;

const issue = (code, path, message, severity = "error", nodeId = null) => Object.freeze({
  code,
  path,
  message,
  severity,
  nodeId,
});

const normalizeToken = (value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim().replace(/^:/, "");
};

const normalizeIdentity = (value, label) => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Number.isSafeInteger(value)) return value;
  throw new TypeError(`${label} must be a non-empty string or safe integer`);
};

const identityKey = (value) => `${typeof value}:${String(value)}`;
const graphNodeId = (value) => `work:${encodeURIComponent(identityKey(value))}`;

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

const clonePortable = (value, label = "portable value", ancestors = new Set()) => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${label} numbers must be finite`);
    return value;
  }
  if (["undefined", "function", "symbol", "bigint"].includes(typeof value)) {
    throw new TypeError(`${label} cannot contain ${typeof value}`);
  }
  if (typeof value !== "object") throw new TypeError(`${label} is not portable`);
  if (ancestors.has(value)) throw new TypeError(`${label} cannot contain reference cycles`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const output = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new TypeError(`${label} arrays cannot contain holes`);
        output.push(clonePortable(value[index], `${label}[${index}]`, ancestors));
      }
      return output;
    }
    const input = plainObject(value, label);
    if (Object.getOwnPropertySymbols(input).length) {
      throw new TypeError(`${label} cannot contain symbol keys`);
    }
    return Object.fromEntries(
      Object.entries(input).map(([key, entry]) => [key, clonePortable(entry, `${label}.${key}`, ancestors)]),
    );
  } finally {
    ancestors.delete(value);
  }
};

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
};

const stableJson = (value) => JSON.stringify(stableValue(value));

const normalizeCapabilities = (value, label) => {
  if (value == null) return [];
  const input = value instanceof Set ? [...value] : value;
  if (!Array.isArray(input)) throw new TypeError(`${label} must be an array or set`);
  return [...new Set(input.map((entry, index) => normalizeToken(entry, `${label}[${index}]`)))].sort();
};

const descriptorValue = (value, keyHint, path) => {
  const input = plainObject(clonePortable(value, path), path);
  const id = normalizeIdentity(
    input.id ?? input.operationId ?? input["operation/id"] ?? keyHint,
    `${path}.id`,
  );
  const kind = normalizeToken(
    input.kind ?? input.operationKind ?? input["operation/kind"],
    `${path}.kind`,
  );
  if (!new Set(["pure", "step"]).has(kind)) {
    throw new Error(`${path}.kind has unsupported value: ${kind}`);
  }
  const version = input.version ?? input.operationVersion ?? input["operation/version"] ?? 1;
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new TypeError(`${path}.version must be a positive safe integer`);
  }
  return Object.freeze({
    id,
    kind,
    version,
    capabilities: Object.freeze(normalizeCapabilities(
      input.capabilities ?? input.operationCapabilities ?? input["operation/capabilities"],
      `${path}.capabilities`,
    )),
    label: typeof (input.label ?? input.name ?? input["operation/metadata"]?.label) === "string"
      ? String(input.label ?? input.name ?? input["operation/metadata"].label).trim() || String(id)
      : String(id),
    metadata: Object.freeze(clonePortable(
      input.metadata ?? input.operationMetadata ?? input["operation/metadata"] ?? {},
      `${path}.metadata`,
    )),
  });
};

export function normalizeWorkOperationRegistry(value = null) {
  if (value == null) return Object.freeze({ provided: false, operations: Object.freeze({}) });
  const operations = {};
  const entries = Array.isArray(value)
    ? value.map((entry, index) => [null, entry, `registry[${index}]`])
    : Object.entries(plainObject(value, "Work operation registry"))
      .map(([key, entry]) => [key, entry, `registry.${key}`]);
  for (const [key, entry, path] of entries) {
    const descriptor = descriptorValue(entry, key, path);
    const identity = identityKey(descriptor.id);
    if (operations[identity]) throw new Error(`Work operation registry repeats ${String(descriptor.id)}`);
    operations[identity] = descriptor;
  }
  return Object.freeze({ provided: true, operations: Object.freeze(operations) });
}

const descriptorFor = (registry, id) => registry.operations[identityKey(id)] ?? null;

const childEntries = (node, path, errors) => {
  const requiredObject = (value, key) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(issue("recipe/missing-child", `${path}.${key}`, `Work recipe ${node.op} requires ${key}`, "error", node.id));
      return null;
    }
    return value;
  };
  const requiredArray = (value, key) => {
    if (!Array.isArray(value)) {
      errors.push(issue("recipe/children-shape", `${path}.${key}`, `Work recipe ${node.op} requires vector ${key}`, "error", node.id));
      return [];
    }
    return value;
  };
  switch (node.op) {
    case "chain":
    case "all":
      return requiredArray(node.children, "children")
        .map((child, index) => ({ role: "children", index, key: null, child }));
    case "each":
    case "filter":
    case "fold": {
      const child = requiredObject(node.work, "work");
      return child ? [{ role: "work", index: 0, key: null, child }] : [];
    }
    case "choose": {
      const output = [];
      const selector = requiredObject(node.selector, "selector");
      if (selector) output.push({ role: "selector", index: 0, key: null, child: selector });
      if (!node.choices || typeof node.choices !== "object" || Array.isArray(node.choices)) {
        errors.push(issue("recipe/choices-shape", `${path}.choices`, "Work recipe choose requires map choices", "error", node.id));
        return output;
      }
      const keys = Object.keys(node.choices).sort();
      keys.forEach((key, index) => output.push({ role: "choice", index, key, child: node.choices[key] }));
      return output;
    }
    case "batch": {
      const output = [];
      ["list", "filter", "process", "summarise"].forEach((role, index) => {
        const value = node[role];
        if (value == null && ["filter", "summarise"].includes(role)) return;
        const child = requiredObject(value, role);
        if (child) output.push({ role, index, key: null, child });
      });
      return output;
    }
    case "ensure": {
      const output = [];
      ["work", "cleanup"].forEach((role, index) => {
        const child = requiredObject(node[role], role);
        if (child) output.push({ role, index, key: null, child });
      });
      return output;
    }
    default:
      return [];
  }
};

const normalizeRecipeInternal = (value, options = {}) => {
  const errors = [];
  const warnings = [];
  const registry = normalizeWorkOperationRegistry(options.registry ?? null);
  const installedCapabilities = new Set(normalizeCapabilities(
    options.capabilities ?? options.installedCapabilities ?? [],
    "Installed work capabilities",
  ));
  let input;
  try {
    input = plainObject(clonePortable(value, "Work recipe"), "Work recipe");
  } catch (error) {
    return { recipe: null, registry, errors: [issue("recipe/not-portable", "$", error.message)], warnings };
  }
  const schema = input.schema ?? WORK_RECIPE_SCHEMA;
  if (schema !== WORK_RECIPE_SCHEMA) {
    errors.push(issue("recipe/schema", "$.schema", `Unsupported work recipe schema: ${schema}`));
  }
  let recipeId = null;
  try {
    recipeId = normalizeIdentity(input["recipe/id"] ?? input.recipeId, "Work recipe id");
  } catch (error) {
    errors.push(issue("recipe/id", "$['recipe/id']", error.message));
  }
  const version = input["recipe/version"] ?? input.recipeVersion ?? 1;
  if (!Number.isSafeInteger(version) || version < 1) {
    errors.push(issue("recipe/version", "$['recipe/version']", "Work recipe version must be a positive safe integer"));
  }
  const metadata = input.metadata ?? {};
  const ids = new Map();
  let count = 0;

  const visit = (value, path, depth) => {
    let node;
    try {
      node = plainObject(value, path);
    } catch (error) {
      errors.push(issue("recipe/node-shape", path, error.message));
      return null;
    }
    count += 1;
    if (count > MAX_RECIPE_NODES) {
      errors.push(issue("recipe/node-limit", path, `Work recipe exceeds ${MAX_RECIPE_NODES} nodes`));
      return null;
    }
    let op = null;
    let id = null;
    try {
      op = normalizeToken(node.op, `${path}.op`);
      if (!SUPPORTED_OPERATIONS.has(op)) {
        errors.push(issue("recipe/operation", `${path}.op`, `Unsupported work recipe operation: ${op}`));
      }
    } catch (error) {
      errors.push(issue("recipe/operation", `${path}.op`, error.message));
    }
    try {
      id = normalizeIdentity(node.id, `${path}.id`);
      const key = identityKey(id);
      if (ids.has(key)) {
        errors.push(issue("recipe/duplicate-node-id", `${path}.id`, `Duplicate work recipe node id: ${String(id)}`, "error", id));
      } else ids.set(key, path);
    } catch (error) {
      errors.push(issue("recipe/node-id", `${path}.id`, error.message));
    }

    const normalized = Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => !STRUCTURAL_KEYS.has(key))
        .map(([key, entry]) => [key, clonePortable(entry, `${path}.${key}`)]),
    );
    if (op) normalized.op = op;
    if (id !== null) normalized.id = id;

    if (op && LEAF_OPERATIONS.has(op)) {
      let uses = null;
      try {
        uses = normalizeIdentity(node.uses, `${path}.uses`);
        normalized.uses = uses;
      } catch (error) {
        errors.push(issue("recipe/uses", `${path}.uses`, error.message, "error", id));
      }
      if (uses !== null && registry.provided) {
        const descriptor = descriptorFor(registry, uses);
        if (!descriptor) {
          errors.push(issue("recipe/unknown-operation", `${path}.uses`, `Unknown installed operation: ${String(uses)}`, "error", id));
        } else {
          const expected = op === "pure-ref" ? "pure" : "step";
          if (descriptor.kind !== expected) {
            errors.push(issue(
              "recipe/operation-kind",
              `${path}.uses`,
              `Node ${String(id)} requires a ${expected} operation but ${String(uses)} is ${descriptor.kind}`,
              "error",
              id,
            ));
          }
          const missing = descriptor.capabilities.filter((capability) => !installedCapabilities.has(capability));
          if (missing.length) {
            errors.push(issue(
              "recipe/missing-capability",
              `${path}.uses`,
              `Operation ${String(uses)} requires unavailable capabilities: ${missing.join(", ")}`,
              "error",
              id,
            ));
          }
        }
      }
    }

    const children = childEntries({ ...node, op, id }, path, errors);
    for (const { role, index, key, child } of children) {
      const childPath = key == null ? `${path}.${role}[${index}]` : `${path}.choices.${key}`;
      const normalizedChild = visit(child, childPath, depth + 1);
      if (!normalizedChild) continue;
      if (role === "children") {
        normalized.children ??= [];
        normalized.children.push(normalizedChild);
      } else if (role === "choice") {
        normalized.choices ??= {};
        normalized.choices[key] = normalizedChild;
      } else {
        normalized[role] = normalizedChild;
      }
    }
    return normalized;
  };

  if (!input.body) errors.push(issue("recipe/body", "$.body", "Work recipe requires a body"));
  const body = input.body ? visit(input.body, "$.body", 0) : null;
  if (!registry.provided) {
    warnings.push(issue(
      "recipe/registry-unavailable",
      "$",
      "No trusted operation registry was supplied; operation existence and capabilities were not checked",
      "warning",
    ));
  }
  const recipe = recipeId === null || !body
    ? null
    : {
      schema: WORK_RECIPE_SCHEMA,
      "recipe/id": recipeId,
      "recipe/version": Number.isSafeInteger(version) && version >= 1 ? version : 1,
      body,
      metadata: clonePortable(metadata, "Work recipe metadata"),
    };
  return { recipe, registry, errors, warnings };
};

export function validateWorkRecipe(value, options = {}) {
  const result = normalizeRecipeInternal(value, options);
  return Object.freeze({
    valid: result.errors.length === 0,
    recipe: result.errors.length === 0 ? Object.freeze(result.recipe) : null,
    errors: Object.freeze(result.errors),
    warnings: Object.freeze(result.warnings),
  });
}

export class WorkRecipeProjectionError extends Error {
  constructor(message, diagnostics) {
    super(message);
    this.name = "WorkRecipeProjectionError";
    this.diagnostics = diagnostics;
  }
}

export function normalizeWorkRecipe(value, options = {}) {
  const validation = validateWorkRecipe(value, options);
  if (!validation.valid) throw new WorkRecipeProjectionError("Work recipe is invalid", validation);
  return validation.recipe;
}

const semanticNode = (node) => {
  const base = Object.fromEntries(SEMANTIC_KEYS
    .filter((key) => Object.hasOwn(node, key))
    .map((key) => [key, clonePortable(node[key], `semantic node ${String(node.id)}.${key}`)]));
  switch (node.op) {
    case "chain":
    case "all":
      return { ...base, children: node.children.map(semanticNode) };
    case "each":
    case "filter":
    case "fold":
      return { ...base, work: semanticNode(node.work) };
    case "choose":
      return {
        ...base,
        selector: semanticNode(node.selector),
        choices: Object.fromEntries(Object.keys(node.choices).sort().map((key) => [key, semanticNode(node.choices[key])])),
      };
    case "batch": {
      const output = { ...base };
      ["list", "filter", "process", "summarise"].forEach((key) => {
        if (node[key]) output[key] = semanticNode(node[key]);
      });
      return output;
    }
    case "ensure":
      return { ...base, work: semanticNode(node.work), cleanup: semanticNode(node.cleanup) };
    default:
      return base;
  }
};

export function workRecipeSemanticSignature(value, options = {}) {
  const recipe = normalizeWorkRecipe(value, options);
  return stableJson({
    schema: WORK_RECIPE_SCHEMA,
    "recipe/id": recipe["recipe/id"],
    "recipe/version": recipe["recipe/version"],
    body: semanticNode(recipe.body),
  });
}

export function canonicalWorkRecipeJson(value, options = {}) {
  return stableJson(normalizeWorkRecipe(value, options));
}

const layoutFor = (layout, semanticId, fallback) => {
  const input = layout?.[identityKey(semanticId)] ?? layout?.[String(semanticId)] ?? layout?.[graphNodeId(semanticId)];
  if (!input || typeof input !== "object" || Array.isArray(input)) return fallback;
  const number = (value, defaultValue) => Number.isFinite(Number(value)) ? Number(value) : defaultValue;
  return {
    x: number(input.x, fallback.x),
    y: number(input.y, fallback.y),
    width: Math.max(1, number(input.width, fallback.width)),
    height: Math.max(1, number(input.height, fallback.height)),
  };
};

const nodeFields = (node) => Object.fromEntries(
  Object.entries(node)
    .filter(([key]) => !STRUCTURAL_KEYS.has(key) && key !== "op" && key !== "id")
    .map(([key, value]) => [key, clonePortable(value)]),
);

const operationSummary = (registry, node) => {
  if (!LEAF_OPERATIONS.has(node.op) || !registry.provided) return null;
  const descriptor = descriptorFor(registry, node.uses);
  if (!descriptor) return null;
  return {
    id: descriptor.id,
    kind: descriptor.kind,
    version: descriptor.version,
    capabilities: [...descriptor.capabilities],
    label: descriptor.label,
    metadata: clonePortable(descriptor.metadata),
  };
};

const edgeId = (parent, role, index, key, child) => [
  "work-edge",
  encodeURIComponent(identityKey(parent)),
  role,
  index,
  key == null ? "-" : encodeURIComponent(key),
  encodeURIComponent(identityKey(child)),
].join(":");

export function projectWorkRecipeGraph(value, options = {}) {
  const validation = validateWorkRecipe(value, options);
  if (!validation.valid) throw new WorkRecipeProjectionError("Cannot project an invalid work recipe", validation);
  const recipe = validation.recipe;
  const registry = normalizeWorkOperationRegistry(options.registry ?? null);
  const layout = options.layout ?? {};
  const nodes = [];
  const connections = [];
  let row = 0;

  const visit = (node, depth) => {
    const semanticId = node.id;
    const id = graphNodeId(semanticId);
    const fallback = {
      x: depth * (DEFAULT_NODE_WIDTH + DEFAULT_COLUMN_GAP),
      y: row * (DEFAULT_NODE_HEIGHT + DEFAULT_ROW_GAP),
      width: DEFAULT_NODE_WIDTH,
      height: DEFAULT_NODE_HEIGHT,
    };
    row += 1;
    const position = layoutFor(layout, semanticId, fallback);
    const descriptor = operationSummary(registry, node);
    nodes.push({
      id,
      type: `std.work/${node.op}`,
      label: descriptor?.label ?? String(node.id),
      ...position,
      ports: [
        { id: "control:in", direction: "in", dataType: "std.work/control", label: "Control" },
        { id: "control:out", direction: "out", dataType: "std.work/control", label: "Control" },
        { id: "value:in", direction: "in", dataType: "std.work/value", label: "Input" },
        { id: "value:out", direction: "out", dataType: "std.work/value", label: "Output" },
      ],
      readOnly: options.readOnly === true,
      metadata: {
        schema: WORK_RECIPE_NODE_SCHEMA,
        recipe: {
          id: clonePortable(node.id),
          op: node.op,
          fields: nodeFields(node),
        },
        operation: descriptor,
        depth,
      },
    });
    const entries = childEntries(node, `node:${String(node.id)}`, []);
    for (const entry of entries) {
      const childId = visit(entry.child, depth + 1);
      connections.push({
        id: edgeId(node.id, entry.role, entry.index, entry.key, entry.child.id),
        from: { nodeId: id, portId: "control:out" },
        to: { nodeId: childId, portId: "control:in" },
        type: "std.work/contains",
        metadata: {
          schema: WORK_RECIPE_EDGE_SCHEMA,
          role: entry.role,
          index: entry.index,
          key: entry.key,
        },
      });
    }
    return id;
  };

  const rootNodeId = visit(recipe.body, 0);
  return normalizeGraph({
    id: options.graphId ?? `work-recipe:${String(recipe["recipe/id"])}`,
    revision: options.revision ?? 0,
    nodes,
    connections,
    metadata: {
      schema: WORK_RECIPE_GRAPH_SCHEMA,
      recipe: {
        schema: recipe.schema,
        id: clonePortable(recipe["recipe/id"]),
        version: recipe["recipe/version"],
        metadata: clonePortable(recipe.metadata),
        rootNodeId,
      },
      semanticSignature: workRecipeSemanticSignature(recipe),
      diagnostics: {
        errors: [],
        warnings: validation.warnings.map((entry) => clonePortable(entry)),
      },
    },
  });
}

const recipeNodeRecord = (node) => {
  const metadata = node.metadata;
  if (!metadata || metadata.schema !== WORK_RECIPE_NODE_SCHEMA || !metadata.recipe) {
    throw new WorkRecipeProjectionError(`Graph node ${node.id} is not a work recipe node`, {
      valid: false,
      errors: [issue("graph/node-metadata", `$.nodes.${node.id}`, "Missing work recipe node metadata")],
      warnings: [],
    });
  }
  const recipe = metadata.recipe;
  return {
    id: clonePortable(recipe.id),
    op: normalizeToken(recipe.op, `Graph node ${node.id} operation`),
    fields: clonePortable(recipe.fields ?? {}, `Graph node ${node.id} fields`),
  };
};

export function workRecipeFromGraph(value) {
  const graph = normalizeGraph(value);
  const graphMetadata = graph.metadata;
  if (graphMetadata?.schema !== WORK_RECIPE_GRAPH_SCHEMA || !graphMetadata.recipe) {
    throw new WorkRecipeProjectionError("Graph is not a work recipe projection", {
      valid: false,
      errors: [issue("graph/schema", "$.metadata.schema", "Missing work recipe graph metadata")],
      warnings: [],
    });
  }
  const records = new Map(graph.nodes.map((node) => [node.id, recipeNodeRecord(node)]));
  const childEdges = new Map();
  for (const connection of graph.connections) {
    if (connection.metadata?.schema !== WORK_RECIPE_EDGE_SCHEMA) continue;
    const list = childEdges.get(connection.from.nodeId) ?? [];
    list.push({
      nodeId: connection.to.nodeId,
      role: connection.metadata.role,
      index: connection.metadata.index,
      key: connection.metadata.key,
    });
    childEdges.set(connection.from.nodeId, list);
  }
  const visiting = new Set();
  const visited = new Set();
  const build = (nodeId) => {
    if (visiting.has(nodeId)) throw new WorkRecipeProjectionError("Work recipe graph contains a cycle", {
      valid: false,
      errors: [issue("graph/cycle", `$.nodes.${nodeId}`, "Work recipe graph relationships must be acyclic")],
      warnings: [],
    });
    const record = records.get(nodeId);
    if (!record) throw new WorkRecipeProjectionError(`Work recipe graph references missing node ${nodeId}`, {
      valid: false,
      errors: [issue("graph/missing-node", `$.nodes.${nodeId}`, "Missing work recipe graph node")],
      warnings: [],
    });
    visiting.add(nodeId);
    visited.add(nodeId);
    const node = { op: record.op, id: clonePortable(record.id), ...clonePortable(record.fields) };
    const edges = [...(childEdges.get(nodeId) ?? [])]
      .sort((left, right) => left.index - right.index || String(left.key ?? "").localeCompare(String(right.key ?? "")));
    const built = edges.map((edge) => ({ ...edge, child: build(edge.nodeId) }));
    switch (record.op) {
      case "chain":
      case "all":
        node.children = built.filter(({ role }) => role === "children").map(({ child }) => child);
        break;
      case "each":
      case "filter":
      case "fold":
        node.work = built.find(({ role }) => role === "work")?.child;
        break;
      case "choose":
        node.selector = built.find(({ role }) => role === "selector")?.child;
        node.choices = Object.fromEntries(
          built.filter(({ role }) => role === "choice").map(({ key, child }) => [key, child]),
        );
        break;
      case "batch":
        ["list", "filter", "process", "summarise"].forEach((role) => {
          const child = built.find((entry) => entry.role === role)?.child;
          if (child) node[role] = child;
        });
        break;
      case "ensure":
        node.work = built.find(({ role }) => role === "work")?.child;
        node.cleanup = built.find(({ role }) => role === "cleanup")?.child;
        break;
      default:
        if (built.length) throw new WorkRecipeProjectionError(`Leaf node ${String(record.id)} has children`, {
          valid: false,
          errors: [issue("graph/leaf-children", `$.nodes.${nodeId}`, "Leaf work recipe nodes cannot contain child relationships")],
          warnings: [],
        });
    }
    visiting.delete(nodeId);
    return node;
  };
  const rootNodeId = graphMetadata.recipe.rootNodeId;
  const body = build(rootNodeId);
  if (visited.size !== records.size) {
    const unreachable = [...records.keys()].filter((id) => !visited.has(id));
    throw new WorkRecipeProjectionError("Work recipe graph contains unreachable nodes", {
      valid: false,
      errors: [issue("graph/unreachable", "$.nodes", `Unreachable work recipe nodes: ${unreachable.join(", ")}`)],
      warnings: [],
    });
  }
  return normalizeWorkRecipe({
    schema: graphMetadata.recipe.schema,
    "recipe/id": clonePortable(graphMetadata.recipe.id),
    "recipe/version": graphMetadata.recipe.version,
    body,
    metadata: clonePortable(graphMetadata.recipe.metadata ?? {}),
  });
}

const normalizeRunNode = (value, idHint, path) => {
  const input = plainObject(clonePortable(value, path), path);
  const id = normalizeIdentity(input.id ?? input.nodeId ?? input["node/id"] ?? idHint, `${path}.id`);
  const status = normalizeToken(input.status ?? "pending", `${path}.status`);
  if (!RUN_NODE_STATUSES.has(status)) throw new Error(`${path}.status has unsupported value: ${status}`);
  const attempt = input.attempt ?? 0;
  if (!Number.isSafeInteger(attempt) || attempt < 0) throw new TypeError(`${path}.attempt must be a non-negative safe integer`);
  const receipt = normalizeToken(input.receiptStatus ?? input.receipt?.status ?? "none", `${path}.receiptStatus`);
  if (!RECEIPT_STATUSES.has(receipt)) throw new Error(`${path}.receiptStatus has unsupported value: ${receipt}`);
  return Object.freeze({
    id,
    status,
    attempt,
    replayed: input.replayed === true,
    checkpointId: input.checkpointId == null ? null : String(input.checkpointId),
    startedAt: input.startedAt ?? null,
    completedAt: input.completedAt ?? null,
    result: clonePortable(input.result ?? null, `${path}.result`),
    error: clonePortable(input.error ?? null, `${path}.error`),
    artifacts: Object.freeze(clonePortable(input.artifacts ?? [], `${path}.artifacts`)),
    receiptStatus: receipt,
  });
};

export function normalizeWorkRun(value) {
  const input = plainObject(clonePortable(value, "Work run"), "Work run");
  const id = normalizeIdentity(input.id ?? input.runId ?? input["run/id"], "Work run id");
  const status = normalizeToken(input.status ?? "created", "Work run status");
  if (!RUN_STATUSES.has(status)) throw new Error(`Work run status has unsupported value: ${status}`);
  const entries = Array.isArray(input.nodes ?? [])
    ? (input.nodes ?? []).map((entry, index) => [null, entry, `run.nodes[${index}]`])
    : Object.entries(plainObject(input.nodes ?? {}, "Work run nodes"))
      .map(([key, entry]) => [key, entry, `run.nodes.${key}`]);
  if (entries.length > MAX_RUN_NODES) throw new Error(`Work run exceeds ${MAX_RUN_NODES} node records`);
  const nodes = {};
  for (const [key, entry, path] of entries) {
    const node = normalizeRunNode(entry, key, path);
    const identity = identityKey(node.id);
    if (nodes[identity]) throw new Error(`Work run repeats node ${String(node.id)}`);
    nodes[identity] = node;
  }
  return Object.freeze({
    schema: WORK_RUN_SCHEMA,
    id,
    status,
    nodes: Object.freeze(nodes),
    createdAt: input.createdAt ?? null,
    updatedAt: input.updatedAt ?? null,
    result: clonePortable(input.result ?? null, "Work run result"),
    error: clonePortable(input.error ?? null, "Work run error"),
    events: Object.freeze(clonePortable(input.events ?? [], "Work run events")),
    receipts: Object.freeze(clonePortable(input.receipts ?? [], "Work run receipts")),
    metadata: Object.freeze(clonePortable(input.metadata ?? {}, "Work run metadata")),
  });
}

export function applyWorkRunOverlay(graphValue, runValue) {
  const graph = normalizeGraph(graphValue);
  if (graph.metadata?.schema !== WORK_RECIPE_GRAPH_SCHEMA) {
    throw new WorkRecipeProjectionError("Run overlays require a work recipe graph", {
      valid: false,
      errors: [issue("graph/schema", "$.metadata.schema", "Graph is not a work recipe projection")],
      warnings: [],
    });
  }
  const run = normalizeWorkRun(runValue);
  const known = new Set();
  const counts = Object.fromEntries([...RUN_NODE_STATUSES].map((status) => [status, 0]));
  const nodes = graph.nodes.map((node) => {
    const semanticId = node.metadata?.recipe?.id;
    const runNode = semanticId == null ? null : run.nodes[identityKey(semanticId)] ?? null;
    if (runNode) {
      known.add(identityKey(semanticId));
      counts[runNode.status] += 1;
    }
    return {
      ...node,
      metadata: {
        ...clonePortable(node.metadata),
        run: runNode ? clonePortable(runNode) : null,
      },
    };
  });
  const unknownNodeIds = Object.values(run.nodes)
    .filter((node) => !known.has(identityKey(node.id)))
    .map((node) => clonePortable(node.id));
  return normalizeGraph({
    ...graph,
    nodes,
    metadata: {
      ...clonePortable(graph.metadata),
      run: {
        schema: WORK_RUN_OVERLAY_SCHEMA,
        id: clonePortable(run.id),
        status: run.status,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        result: clonePortable(run.result),
        error: clonePortable(run.error),
        events: clonePortable(run.events),
        receipts: clonePortable(run.receipts),
        counts,
        unknownNodeIds,
      },
    },
  });
}

export function inspectWorkRecipe(value, options = {}) {
  const validation = validateWorkRecipe(value, options);
  return Object.freeze({
    validation,
    graph: validation.valid ? projectWorkRecipeGraph(validation.recipe, options) : null,
    semanticSignature: validation.valid ? workRecipeSemanticSignature(validation.recipe) : null,
  });
}
