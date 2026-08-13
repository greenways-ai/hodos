export const PLAYCANVAS_MIXAMO_CHARACTER_SCHEMA = "hodos.playcanvas-mixamo-character/0-alpha";
export const PLAYCANVAS_MIXAMO_PROVIDER_ID = "playcanvas/mixamo";
export const PLAYCANVAS_MIXAMO_PROVIDER_VERSION = "0-alpha.1";
export const DEFAULT_MIXAMO_MAX_CHARACTERS = 32;
export const DEFAULT_MIXAMO_MAX_NODES = 1024;

export function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
}

export function optionalString(value, label) {
  if (value === null || value === undefined || value === "") return null;
  return requiredString(value, label);
}

export function positiveSafeInteger(value, fallback, label) {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return candidate;
}

export function finite(value, fallback, label, minimum = -Infinity) {
  const candidate = value ?? fallback;
  if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < minimum) {
    throw new TypeError(`${label} must be a finite number greater than or equal to ${minimum}`);
  }
  return candidate;
}

export function portableCopy(value, seen = new Set()) {
  if (value === null || ["string", "boolean"].includes(typeof value)) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Portable numbers must be finite");
    return value;
  }
  if (typeof value !== "object" || seen.has(value)) throw new TypeError("Value is not portable");
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => portableCopy(entry, seen));
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new TypeError("Portable values require plain objects");
    }
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, portableCopy(entry, seen)]));
  } finally {
    seen.delete(value);
  }
}

export class PlayCanvasMixamoCharacterHostError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "PlayCanvasMixamoCharacterHostError";
    this.code = requiredString(code, "Mixamo host error code");
    this.details = details === null ? null : portableCopy(details);
  }
}

function childrenOf(entity) {
  const children = typeof entity?.getChildren === "function" ? entity.getChildren() : entity?.children;
  if (children === null || children === undefined) return [];
  if (!Array.isArray(children)) throw new TypeError("PlayCanvas entity children must be an array");
  return children;
}

function entityId(entity, fallback) {
  const guid = typeof entity?.getGuid === "function" ? entity.getGuid() : entity?.guid ?? entity?._guid;
  if (typeof guid === "string" && guid.trim()) return guid.trim();
  if (typeof entity?.id === "string" && entity.id.trim()) return entity.id.trim();
  if (Number.isSafeInteger(entity?.id) && entity.id >= 0) return `entity:${entity.id}`;
  return fallback;
}

export function flattenMixamoEntityHierarchy(root, maximumNodes) {
  if (!root || typeof root !== "object") throw new TypeError("Mixamo character root must be an Entity-like object");
  const stack = [{ entity: root, parentId: null, path: "0" }];
  const seenEntities = new Set();
  const seenIds = new Set();
  const nodes = [];
  while (stack.length) {
    const current = stack.pop();
    if (seenEntities.has(current.entity)) {
      throw new PlayCanvasMixamoCharacterHostError("mixamo/entity-cycle", `Entity hierarchy cycles at ${current.path}`);
    }
    seenEntities.add(current.entity);
    if (nodes.length >= maximumNodes) {
      throw new PlayCanvasMixamoCharacterHostError("mixamo/node-limit", `Character exceeds the ${maximumNodes} node limit`);
    }
    const id = entityId(current.entity, `entity-path:${current.path}`);
    if (seenIds.has(id)) throw new PlayCanvasMixamoCharacterHostError("mixamo/entity-id", `Repeated entity id ${id}`);
    seenIds.add(id);
    nodes.push({
      id,
      name: typeof current.entity.name === "string" && current.entity.name.trim()
        ? current.entity.name.trim()
        : `Entity ${current.path}`,
      parentId: current.parentId,
    });
    const children = childrenOf(current.entity);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ entity: children[index], parentId: id, path: `${current.path}.${index}` });
    }
  }
  return { nodes, rootNodeId: nodes[0].id };
}

export function findMixamoAnimation(root) {
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const entity = stack.pop();
    if (!entity || seen.has(entity)) continue;
    seen.add(entity);
    if (entity.anim) return { component: entity.anim, kind: "anim" };
    if (entity.animation) return { component: entity.animation, kind: "animation" };
    const children = childrenOf(entity);
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
  return { component: null, kind: null };
}

function clipState(value, fallback, label) {
  const state = requiredString(value ?? fallback, label);
  if (state.includes(".")) throw new TypeError(`${label} must not contain '.'`);
  return state;
}

export function mixamoClipDescriptor(id, value = {}) {
  const input = typeof value === "number"
    ? { duration: value }
    : typeof value === "string"
      ? { state: value }
      : value;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`Mixamo clip ${id} must be an object, state name, or duration`);
  }
  return {
    id: requiredString(id, "Mixamo clip id"),
    state: clipState(input.state ?? input.stateName, id, `Mixamo clip ${id} state`),
    duration: input.duration === null || input.duration === undefined
      ? null
      : finite(input.duration, null, `Mixamo clip ${id} duration`, 0),
    loop: input.loop !== false,
    speed: finite(input.speed, 1, `Mixamo clip ${id} speed`, 0),
    layer: optionalString(input.layer, `Mixamo clip ${id} layer`),
    resourceId: optionalString(input.resourceId ?? input.resource, `Mixamo clip ${id} resourceId`),
    owned: false,
    track: null,
  };
}

export function mixamoClipCatalog(value) {
  if (value === null || value === undefined) return new Map();
  const entries = Array.isArray(value)
    ? value.map((entry, index) => typeof entry === "string"
      ? [entry, {}]
      : [requiredString(entry?.id ?? entry?.name, `Mixamo clip ${index} id`), entry])
    : Object.entries(value);
  const output = new Map();
  for (const [id, descriptor] of entries) {
    if (output.has(id)) throw new Error(`Mixamo clip catalog repeats ${id}`);
    output.set(id, mixamoClipDescriptor(id, descriptor));
  }
  return output;
}

export function portableMixamoClip(clip) {
  return {
    id: clip.id,
    state: clip.state,
    duration: clip.duration,
    loop: clip.loop,
    speed: clip.speed,
    layer: clip.layer,
    resourceId: clip.resourceId,
    assigned: clip.owned,
  };
}

export function mixamoAnimationLayer(component, name) {
  if (!component) return null;
  if (name && typeof component.findAnimationLayer === "function") return component.findAnimationLayer(name);
  return component.baseLayer ?? null;
}

export function mixamoReferences(value) {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return [value.mixamoHandle, value.handle, value.characterId, value.id, value.entityId]
    .filter((entry) => typeof entry === "string" && entry);
}
