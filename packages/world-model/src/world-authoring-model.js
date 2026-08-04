import {
  normalizeWorldEntity,
  normalizeWorldTransform,
  structuredCloneSafe,
  worldVector3,
} from "./world-editor-model.js";

export const ADVANCED_ENTITY_KINDS = Object.freeze([
  "camera",
  "trigger",
  "asset-instance",
]);

export const EDITOR_PIVOTS = Object.freeze(["median", "active", "individual", "cursor"]);
export const EDITOR_SPACES = Object.freeze(["world", "local"]);
export const EDITOR_SELECTION_MODES = Object.freeze(["replace", "add", "toggle", "subtract"]);
export const DEFAULT_HARA_SCRIPT = `(fn [event entity world]
  {"trace" {"event" (get event "event/type")
            "entity" (get entity "id")}
   "entity" entity})`;

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function normalizeCollection(value = {}, index = 0) {
  const id = String(value.id || `collection-${index + 1}`).trim();
  if (!id) throw new Error("Collection requires an id");
  return {
    id,
    name: String(value.name || id),
    parent: value.parent ? String(value.parent) : null,
    visible: value.visible !== false,
    locked: Boolean(value.locked),
  };
}

export function normalizeAsset(value = {}, index = 0) {
  const id = String(value.id || `asset-${index + 1}`).trim();
  if (!id) throw new Error("Asset requires an id");
  const kind = ["primitive", "light", "camera", "trigger", "gltf", "prefab"].includes(value.kind)
    ? value.kind
    : "gltf";
  return {
    id,
    name: String(value.name || id),
    kind,
    url: value.url ? String(value.url) : null,
    thumbnail: value.thumbnail ? String(value.thumbnail) : null,
    metadata: value.metadata && typeof value.metadata === "object"
      ? structuredCloneSafe(value.metadata)
      : {},
  };
}

export function normalizePrefab(value = {}, index = 0) {
  const id = String(value.id || `prefab-${index + 1}`).trim();
  if (!id) throw new Error("Prefab requires an id");
  const entities = (value.entities ?? []).map(normalizeWorldEntity);
  const ids = new Set();
  for (const entity of entities) {
    if (ids.has(entity.id)) throw new Error(`Prefab contains duplicate entity id: ${entity.id}`);
    ids.add(entity.id);
  }
  return {
    id,
    name: String(value.name || id),
    description: String(value.description || ""),
    entities,
    rootIds: Array.isArray(value.rootIds)
      ? value.rootIds.filter((entityId) => ids.has(entityId)).map(String)
      : entities.filter((entity) => !entity.parent || !ids.has(entity.parent)).map((entity) => entity.id),
  };
}

function normalizeKeyframe(value = {}) {
  return {
    id: String(value.id || `key-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`),
    time: Math.max(0, finite(value.time, 0)),
    value: structuredCloneSafe(value.value ?? 0),
    easing: ["linear", "step", "ease-in", "ease-out", "ease-in-out"].includes(value.easing)
      ? value.easing
      : "linear",
  };
}

export function normalizeAnimationTrack(value = {}, index = 0) {
  const id = String(value.id || `track-${index + 1}`);
  const keyframes = (value.keyframes ?? []).map(normalizeKeyframe)
    .sort((left, right) => left.time - right.time);
  return {
    id,
    entity: String(value.entity || ""),
    property: ["position", "rotation", "scale", "visible", "light.intensity"].includes(value.property)
      ? value.property
      : "position",
    enabled: value.enabled !== false,
    keyframes,
  };
}

export function normalizeAnimation(value = {}, index = 0) {
  return {
    id: String(value.id || (index === 0 ? "main" : `animation-${index + 1}`)),
    name: String(value.name || (index === 0 ? "Main" : `Animation ${index + 1}`)),
    duration: Math.max(0.1, finite(value.duration, 10)),
    fps: clamp(Math.round(finite(value.fps, 30)), 1, 120),
    tracks: (value.tracks ?? []).map(normalizeAnimationTrack),
  };
}

export function normalizeAuthoringDocument(value = {}) {
  const entities = (value.entities ?? []).map((entry) => {
    const entity = normalizeWorldEntity(entry);
    return {
      ...entity,
      collection: entry.collection ? String(entry.collection) : null,
      origin: worldVector3(entry.origin, [0, 0, 0]),
    };
  });
  const audioSources = structuredCloneSafe(value.audioSources ?? []);
  const collections = (value.collections ?? []).map(normalizeCollection);
  const assets = (value.assets ?? []).map(normalizeAsset);
  const prefabs = (value.prefabs ?? []).map(normalizePrefab);
  const animations = (value.animations?.length ? value.animations : [{ id: "main" }]).map(normalizeAnimation);
  return { entities, audioSources, collections, assets, prefabs, animations };
}

export function normalizeAdvancedEditor(value = {}) {
  const selection = Array.isArray(value.selection)
    ? value.selection.filter((target) => target?.id && ["entity", "audio"].includes(target.type))
      .map((target) => ({ type: target.type, id: String(target.id) }))
    : [];
  const active = value.active?.id
    ? { type: value.active.type, id: String(value.active.id) }
    : selection.at(-1) ?? null;
  const snap = value.snap ?? {};
  const timeline = value.timeline ?? {};
  return {
    mode: value.mode === "preview" ? "preview" : "edit",
    tool: ["select", "box", "translate", "rotate", "scale"].includes(value.tool) ? value.tool : "select",
    space: EDITOR_SPACES.includes(value.space) ? value.space : "world",
    pivot: EDITOR_PIVOTS.includes(value.pivot) ? value.pivot : "median",
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

export function applySelectionMode(current = [], incoming = [], mode = "replace") {
  const selected = new Map(current.map((target) => [`${target.type}:${target.id}`, target]));
  if (mode === "replace") return incoming.map((target) => ({ ...target }));
  for (const target of incoming) {
    const key = `${target.type}:${target.id}`;
    if (mode === "subtract") selected.delete(key);
    else if (mode === "toggle" && selected.has(key)) selected.delete(key);
    else selected.set(key, { ...target });
  }
  return [...selected.values()];
}

export function projectedTargetsInRect(targets, rect) {
  const left = Math.min(rect.left, rect.right);
  const right = Math.max(rect.left, rect.right);
  const top = Math.min(rect.top, rect.bottom);
  const bottom = Math.max(rect.top, rect.bottom);
  return targets.filter(({ x, y, visible = true }) => visible && x >= left && x <= right && y >= top && y <= bottom)
    .map(({ type, id }) => ({ type, id }));
}

function targetPosition(document, target) {
  if (target.type === "audio") {
    return worldVector3(document.audioSources.find((source) => source.id === target.id)?.position, [0, 0, 0]);
  }
  return worldVector3(document.entities.find((entity) => entity.id === target.id)?.transform?.position, [0, 0, 0]);
}

export function selectionPivot(documentValue, editorValue) {
  const document = normalizeAuthoringDocument(documentValue);
  const editor = normalizeAdvancedEditor(editorValue);
  if (editor.pivot === "cursor") return [...editor.cursor];
  if (!editor.selection.length) return [0, 0, 0];
  if (editor.pivot === "active" && editor.active) return targetPosition(document, editor.active);
  const positions = editor.selection.map((target) => targetPosition(document, target));
  return [0, 1, 2].map((axis) => positions.reduce((sum, position) => sum + position[axis], 0) / positions.length);
}

function snapValue(value, step, enabled) {
  return enabled ? Math.round(value / step) * step : value;
}

function rotatePoint(position, pivot, axis, degrees) {
  const radians = degrees * Math.PI / 180;
  const sine = Math.sin(radians);
  const cosine = Math.cos(radians);
  const relative = position.map((value, index) => value - pivot[index]);
  let next;
  if (axis === 0) next = [relative[0], relative[1] * cosine - relative[2] * sine, relative[1] * sine + relative[2] * cosine];
  else if (axis === 1) next = [relative[0] * cosine + relative[2] * sine, relative[1], -relative[0] * sine + relative[2] * cosine];
  else next = [relative[0] * cosine - relative[1] * sine, relative[0] * sine + relative[1] * cosine, relative[2]];
  return next.map((value, index) => value + pivot[index]);
}

export function transformSelectionItems(documentValue, editorValue, {
  tool,
  axes = [0],
  amount = 0,
  uniform = false,
} = {}) {
  const document = normalizeAuthoringDocument(documentValue);
  const editor = normalizeAdvancedEditor(editorValue);
  const pivot = selectionPivot(document, editor);
  const enabled = editor.snap.enabled;
  const items = [];

  for (const target of editor.selection) {
    if (target.type === "audio") {
      const source = document.audioSources.find((entry) => entry.id === target.id);
      if (!source || tool !== "translate") continue;
      const position = worldVector3(source.position, [0, 0, 0]);
      for (const axis of axes) position[axis] = snapValue(position[axis] + amount, editor.snap.translate, enabled);
      items.push({ type: "audio", id: source.id, position });
      continue;
    }

    const entity = document.entities.find((entry) => entry.id === target.id);
    if (!entity || entity.locked) continue;
    const transform = normalizeWorldTransform(entity.transform);
    if (tool === "translate") {
      for (const axis of axes) transform.position[axis] = snapValue(
        transform.position[axis] + amount,
        editor.snap.translate,
        enabled,
      );
    } else if (tool === "rotate") {
      const degrees = snapValue(amount, editor.snap.rotate, enabled);
      for (const axis of axes) {
        transform.rotation[axis] = snapValue(transform.rotation[axis] + degrees, editor.snap.rotate, enabled);
        if (editor.pivot !== "individual") transform.position = rotatePoint(transform.position, pivot, axis, degrees);
      }
    } else if (tool === "scale") {
      const factor = Math.max(0.01, 1 + amount);
      const scaleAxes = uniform ? [0, 1, 2] : axes;
      for (const axis of scaleAxes) transform.scale[axis] = Math.max(
        0.01,
        snapValue(transform.scale[axis] * factor, editor.snap.scale, enabled),
      );
      if (editor.pivot !== "individual") {
        transform.position = transform.position.map((value, axis) => (
          scaleAxes.includes(axis) ? pivot[axis] + (value - pivot[axis]) * factor : value
        ));
      }
    }
    items.push({ type: "entity", id: entity.id, transform });
  }
  return items;
}

export function createCollection(documentValue, collection) {
  const document = normalizeAuthoringDocument(documentValue);
  const normalized = normalizeCollection(collection, document.collections.length);
  if (document.collections.some((entry) => entry.id === normalized.id)) {
    throw new Error(`Collection already exists: ${normalized.id}`);
  }
  return { ...document, collections: [...document.collections, normalized] };
}

export function deleteCollection(documentValue, collectionId) {
  const document = normalizeAuthoringDocument(documentValue);
  return {
    ...document,
    collections: document.collections.filter((entry) => entry.id !== collectionId)
      .map((entry) => entry.parent === collectionId ? { ...entry, parent: null } : entry),
    entities: document.entities.map((entity) => entity.collection === collectionId ? { ...entity, collection: null } : entity),
  };
}

export function moveSelectionToCollection(documentValue, editorValue, collectionId) {
  const document = normalizeAuthoringDocument(documentValue);
  const selected = new Set(normalizeAdvancedEditor(editorValue).selection
    .filter((target) => target.type === "entity")
    .map((target) => target.id));
  return {
    ...document,
    entities: document.entities.map((entity) => selected.has(entity.id) ? { ...entity, collection: collectionId || null } : entity),
  };
}

export function capturePrefab(documentValue, editorValue, { id, name } = {}) {
  const document = normalizeAuthoringDocument(documentValue);
  const selected = new Set(normalizeAdvancedEditor(editorValue).selection
    .filter((target) => target.type === "entity")
    .map((target) => target.id));
  const entities = document.entities.filter((entity) => selected.has(entity.id)).map(structuredCloneSafe);
  if (!entities.length) throw new Error("Select at least one entity to create a prefab");
  const selectedIds = new Set(entities.map((entity) => entity.id));
  const rootIds = entities.filter((entity) => !entity.parent || !selectedIds.has(entity.parent)).map((entity) => entity.id);
  return normalizePrefab({
    id,
    name,
    entities: entities.map((entity) => ({
      ...entity,
      parent: selectedIds.has(entity.parent) ? entity.parent : null,
    })),
    rootIds,
  });
}

export function instantiatePrefab(prefabValue, {
  idFor = (sourceId) => `${sourceId}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
  position = [0, 0, 0],
  collection = null,
} = {}) {
  const prefab = normalizePrefab(prefabValue);
  const ids = new Map(prefab.entities.map((entity) => [entity.id, idFor(entity.id)]));
  const rootIds = new Set(prefab.rootIds);
  return prefab.entities.map((entity) => {
    const transform = normalizeWorldTransform(entity.transform);
    if (rootIds.has(entity.id)) {
      transform.position = transform.position.map((value, axis) => value + finite(position[axis], 0));
    }
    return {
      ...structuredCloneSafe(entity),
      id: ids.get(entity.id),
      name: `${entity.name}`,
      parent: entity.parent ? ids.get(entity.parent) ?? null : null,
      collection: collection ?? entity.collection ?? null,
      transform,
    };
  });
}

export function setAnimationKeyframe(animationValue, {
  entity,
  property,
  time,
  value,
  easing = "linear",
  id,
} = {}) {
  const animation = normalizeAnimation(animationValue);
  let track = animation.tracks.find((entry) => entry.entity === entity && entry.property === property);
  if (!track) {
    track = normalizeAnimationTrack({
      id: `track-${entity}-${property}`,
      entity,
      property,
      keyframes: [],
    });
    animation.tracks.push(track);
  }
  const next = normalizeKeyframe({ id, time, value, easing });
  const index = track.keyframes.findIndex((entry) => Math.abs(entry.time - next.time) < 1e-6);
  if (index >= 0) track.keyframes[index] = next;
  else track.keyframes.push(next);
  track.keyframes.sort((left, right) => left.time - right.time);
  animation.duration = Math.max(animation.duration, next.time);
  return animation;
}

function easingAmount(amount, easing) {
  if (easing === "step") return 0;
  if (easing === "ease-in") return amount * amount;
  if (easing === "ease-out") return 1 - (1 - amount) * (1 - amount);
  if (easing === "ease-in-out") return amount < 0.5 ? 2 * amount * amount : 1 - ((-2 * amount + 2) ** 2) / 2;
  return amount;
}

function interpolate(left, right, amount) {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.map((value, index) => finite(value) + (finite(right[index]) - finite(value)) * amount);
  }
  if (typeof left === "number" && typeof right === "number") return left + (right - left) * amount;
  return amount < 1 ? structuredCloneSafe(left) : structuredCloneSafe(right);
}

export function evaluateAnimation(animationValue, time) {
  const animation = normalizeAnimation(animationValue);
  const at = clamp(finite(time, 0), 0, animation.duration);
  const values = [];
  for (const track of animation.tracks) {
    if (!track.enabled || !track.keyframes.length) continue;
    let left = track.keyframes[0];
    let right = track.keyframes.at(-1);
    for (let index = 0; index < track.keyframes.length - 1; index += 1) {
      if (at >= track.keyframes[index].time && at <= track.keyframes[index + 1].time) {
        left = track.keyframes[index];
        right = track.keyframes[index + 1];
        break;
      }
    }
    const span = Math.max(1e-9, right.time - left.time);
    const amount = left === right ? 0 : easingAmount(clamp((at - left.time) / span, 0, 1), left.easing);
    values.push({
      entity: track.entity,
      property: track.property,
      value: interpolate(left.value, right.value, amount),
    });
  }
  return values;
}

export function attachScript(entityValue, {
  source = DEFAULT_HARA_SCRIPT,
  events = ["world/start", "world/entity-transform"],
  enabled = true,
} = {}) {
  const entity = normalizeWorldEntity(entityValue);
  const components = structuredCloneSafe(entity.components ?? {});
  components.script = {
    language: "hara",
    enabled: Boolean(enabled),
    events: [...new Set(events.map(String).filter(Boolean))],
    source: String(source),
  };
  return { ...entityValue, ...entity, components };
}

export function documentChanged(left, right) {
  return !same(normalizeAuthoringDocument(left), normalizeAuthoringDocument(right));
}
