export const WORLD_ENTITY_KINDS = Object.freeze([
  "empty",
  "box",
  "sphere",
  "plane",
  "cylinder",
  "cone",
  "capsule",
  "point-light",
  "camera",
  "trigger",
  "asset-instance",
]);

export const WORLD_EDITOR_TOOLS = Object.freeze(["select", "box", "translate", "rotate", "scale"]);
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
  if (kind === "camera") {
    return {
      camera: {
        fov: 60,
        nearClip: 0.05,
        farClip: 1000,
        active: false,
      },
    };
  }
  if (kind === "trigger") {
    return {
      trigger: {
        shape: "box",
        size: [1, 1, 1],
        event: "world/trigger-enter",
        once: false,
      },
    };
  }
  if (kind === "asset-instance") {
    return {
      asset: {
        id: null,
        url: null,
        format: "gltf",
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
  if (components.camera) {
    components.camera.fov = Math.max(10, Math.min(150, finite(components.camera.fov, 60)));
    components.camera.nearClip = Math.max(0.001, finite(components.camera.nearClip, 0.05));
    components.camera.farClip = Math.max(components.camera.nearClip + 0.01, finite(components.camera.farClip, 1000));
    components.camera.active = Boolean(components.camera.active);
  }
  if (components.trigger) {
    components.trigger.shape = ["box", "sphere"].includes(components.trigger.shape) ? components.trigger.shape : "box";
    components.trigger.size = worldScale3(components.trigger.size, [1, 1, 1]);
    components.trigger.event = String(components.trigger.event || "world/trigger-enter");
    components.trigger.once = Boolean(components.trigger.once);
  }
  if (components.asset) {
    components.asset.id = components.asset.id ? String(components.asset.id) : null;
    components.asset.url = components.asset.url ? String(components.asset.url) : null;
    components.asset.format = String(components.asset.format || "gltf");
  }
  if (components.script) {
    components.script.language = "hara";
    components.script.enabled = components.script.enabled !== false;
    components.script.events = Array.isArray(components.script.events)
      ? [...new Set(components.script.events.map(String).filter(Boolean))]
      : [];
    components.script.source = String(components.script.source || "");
  }
  return {
    id,
    name: String(value.name || id),
    kind,
    parent: value.parent ? String(value.parent) : null,
    collection: value.collection ? String(value.collection) : null,
    visible: value.visible !== false,
    locked: Boolean(value.locked),
    origin: worldVector3(value.origin, [0, 0, 0]),
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
  collection = null,
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
    camera: "Camera",
    trigger: "Trigger Volume",
    "asset-instance": "Asset Instance",
  };
  return normalizeWorldEntity({
    id: entityId,
    name: name || labels[kind] || kind,
    kind,
    parent,
    collection,
    origin: [0, 0, 0],
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
  const snap = value.snap ?? {};
  const timeline = value.timeline ?? {};
  return {
    mode,
    tool,
    space: value.space === "local" ? "local" : "world",
    pivot: ["median", "active", "individual", "cursor"].includes(value.pivot) ? value.pivot : "median",
    cursor: worldVector3(value.cursor, [0, 0, 0]),
    snap: {
      enabled: Boolean(snap.enabled),
      translate: Math.max(0.0001, finite(snap.translate, 0.25)),
      rotate: Math.max(0.1, finite(snap.rotate, 5)),
      scale: Math.max(0.001, finite(snap.scale, 0.1)),
    },
    isolation: value.isolation ? String(value.isolation) : null,
    activeCollection: value.activeCollection ? String(value.activeCollection) : null,
    selection,
    active,
    timeline: {
      animation: String(timeline.animation || "main"),
      time: Math.max(0, finite(timeline.time, 0)),
      playing: Boolean(timeline.playing),
      loop: Boolean(timeline.loop),
    },
  };
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

export function selectedWorldItems(state) {
  const editor = editorState(state?.world?.editor ?? state?.world?.draft?.editor);
  const entities = new Map((state?.world?.draft?.entities ?? []).map((entry) => [entry.id, normalizeWorldEntity(entry)]));
  const audio = new Map((state?.world?.draft?.audioSources ?? state?.world?.audioSources ?? []).map((entry) => [entry.id, entry]));
  return editor.selection.flatMap((target) => {
    const value = target.type === "entity" ? entities.get(target.id) : audio.get(target.id);
    return value ? [{ type: target.type, value }] : [];
  });
}

export function worldEntityRadius(entity) {
  const normalized = normalizeWorldEntity(entity);
  const scale = normalized.transform.scale;
  if (normalized.kind === "camera") return Math.max(0.25, Math.hypot(...scale) * 0.3);
  if (normalized.kind === "trigger") return Math.max(0.25, Math.hypot(...normalized.components.trigger.size) * 0.45);
  return Math.max(0.18, Math.hypot(scale[0], scale[1], scale[2]) * 0.42);
}
