export const WORLD_ENTITY_KINDS = Object.freeze([
  "empty",
  "box",
  "sphere",
  "plane",
  "cylinder",
  "cone",
  "capsule",
  "point-light",
]);

export const WORLD_EDITOR_TOOLS = Object.freeze(["select", "translate", "rotate", "scale"]);
export const WORLD_EDITOR_MODES = Object.freeze(["edit", "preview"]);

const DEFAULT_COLOR = "#c8ad73";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function worldVector3(value, fallback = [0, 0, 0]) {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback];
  return value.map((entry, index) => finite(entry, fallback[index]));
}

export function worldScale3(value, fallback = [1, 1, 1]) {
  return worldVector3(value, fallback).map((entry) => Math.max(0.01, Math.abs(entry)));
}

export function normalizeWorldTransform(value = {}) {
  return {
    position: worldVector3(value.position, [0, 0, 0]),
    rotation: worldVector3(value.rotation, [0, 0, 0]),
    scale: worldScale3(value.scale, [1, 1, 1]),
  };
}

function defaultComponents(kind) {
  if (kind === "point-light") {
    return {
      light: {
        type: "point",
        color: "#fff1ca",
        intensity: 1,
        range: 12,
        castShadows: false,
      },
    };
  }
  if (kind === "empty") return {};
  return {
    primitive: {
      shape: kind,
      color: DEFAULT_COLOR,
      opacity: 1,
    },
  };
}

export function normalizeWorldEntity(value = {}) {
  const kind = WORLD_ENTITY_KINDS.includes(value.kind) ? value.kind : "empty";
  const id = String(value.id || "").trim();
  if (!id) throw new Error("World entity requires an id");
  const components = value.components && typeof value.components === "object"
    ? structuredCloneSafe(value.components)
    : defaultComponents(kind);
  if (components.primitive) {
    components.primitive.shape = WORLD_ENTITY_KINDS.includes(components.primitive.shape)
      ? components.primitive.shape
      : kind;
    components.primitive.color = HEX_COLOR.test(components.primitive.color || "")
      ? components.primitive.color
      : DEFAULT_COLOR;
    components.primitive.opacity = Math.max(0, Math.min(1, finite(components.primitive.opacity, 1)));
  }
  if (components.light) {
    components.light.type = "point";
    components.light.color = HEX_COLOR.test(components.light.color || "")
      ? components.light.color
      : "#fff1ca";
    components.light.intensity = Math.max(0, finite(components.light.intensity, 1));
    components.light.range = Math.max(0.1, finite(components.light.range, 12));
    components.light.castShadows = Boolean(components.light.castShadows);
  }
  return {
    id,
    name: String(value.name || id),
    kind,
    parent: value.parent ? String(value.parent) : null,
    visible: value.visible !== false,
    locked: Boolean(value.locked),
    transform: normalizeWorldTransform(value.transform),
    components,
  };
}

export function structuredCloneSafe(value) {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function createWorldEntity(kind, {
  id,
  name,
  position = [0, 0, 0],
  parent = null,
} = {}) {
  if (!WORLD_ENTITY_KINDS.includes(kind)) throw new Error(`Unsupported world entity kind: ${kind}`);
  const entityId = String(id || "").trim();
  if (!entityId) throw new Error("Creating a world entity requires an id");
  const labels = {
    empty: "Empty",
    box: "Cube",
    sphere: "Sphere",
    plane: "Plane",
    cylinder: "Cylinder",
    cone: "Cone",
    capsule: "Capsule",
    "point-light": "Point Light",
  };
  return normalizeWorldEntity({
    id: entityId,
    name: name || labels[kind] || kind,
    kind,
    parent,
    transform: {
      position,
      rotation: [0, 0, 0],
      scale: kind === "plane" ? [2, 0.05, 2] : [1, 1, 1],
    },
    components: defaultComponents(kind),
  });
}

export function duplicateWorldEntity(entity, id, { offset = [0.35, 0, 0.35] } = {}) {
  const source = normalizeWorldEntity(entity);
  const position = source.transform.position.map((value, index) => value + finite(offset[index], 0));
  return normalizeWorldEntity({
    ...structuredCloneSafe(source),
    id,
    name: `${source.name} Copy`,
    transform: { ...source.transform, position },
  });
}

export function patchWorldEntity(entity, patch = {}) {
  const source = normalizeWorldEntity(entity);
  return normalizeWorldEntity({
    ...source,
    ...patch,
    transform: patch.transform
      ? { ...source.transform, ...patch.transform }
      : source.transform,
    components: patch.components
      ? { ...source.components, ...patch.components }
      : source.components,
  });
}

export function worldEntityMap(entities = []) {
  const map = new Map();
  for (const value of entities) {
    const entity = normalizeWorldEntity(value);
    if (map.has(entity.id)) throw new Error(`Duplicate world entity id: ${entity.id}`);
    map.set(entity.id, entity);
  }
  return map;
}

export function flattenWorldHierarchy(entities = []) {
  const map = worldEntityMap(entities);
  const children = new Map([[null, []]]);
  for (const entity of map.values()) {
    const parent = entity.parent && map.has(entity.parent) && entity.parent !== entity.id
      ? entity.parent
      : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(entity);
  }
  for (const values of children.values()) values.sort((a, b) => a.name.localeCompare(b.name));

  const output = [];
  const visited = new Set();
  const visit = (entity, depth, ancestry) => {
    if (visited.has(entity.id)) return;
    visited.add(entity.id);
    output.push({ entity, depth });
    if (ancestry.has(entity.id)) return;
    const nextAncestry = new Set(ancestry).add(entity.id);
    for (const child of children.get(entity.id) ?? []) visit(child, depth + 1, nextAncestry);
  };
  for (const root of children.get(null) ?? []) visit(root, 0, new Set());
  for (const entity of map.values()) if (!visited.has(entity.id)) visit(entity, 0, new Set());
  return output;
}

export function editorState(value = {}) {
  const mode = WORLD_EDITOR_MODES.includes(value.mode) ? value.mode : "edit";
  const tool = WORLD_EDITOR_TOOLS.includes(value.tool) ? value.tool : "select";
  const selection = Array.isArray(value.selection)
    ? value.selection.filter((entry) => entry?.id && ["entity", "audio"].includes(entry.type))
      .map((entry) => ({ type: entry.type, id: String(entry.id) }))
    : [];
  const active = value.active?.id && ["entity", "audio"].includes(value.active.type)
    ? { type: value.active.type, id: String(value.active.id) }
    : selection.at(-1) ?? null;
  return { mode, tool, space: value.space === "local" ? "local" : "world", selection, active };
}

export function activeWorldItem(state) {
  const editor = editorState(state?.world?.editor ?? state?.world?.draft?.editor);
  if (!editor.active) return null;
  if (editor.active.type === "audio") {
    const source = (state?.world?.draft?.audioSources ?? state?.world?.audioSources ?? [])
      .find((entry) => entry.id === editor.active.id);
    return source ? { type: "audio", value: source } : null;
  }
  const entity = (state?.world?.draft?.entities ?? [])
    .find((entry) => entry.id === editor.active.id);
  return entity ? { type: "entity", value: normalizeWorldEntity(entity) } : null;
}

export function worldEntityRadius(entity) {
  const normalized = normalizeWorldEntity(entity);
  const scale = normalized.transform.scale;
  return Math.max(0.18, Math.hypot(scale[0], scale[1], scale[2]) * 0.42);
}
