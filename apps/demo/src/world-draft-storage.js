import { safeFilename, saveBlob } from "./studio-export.js";
import { createStudioStore } from "./studio-storage.js";

const RECORD_FORMAT = "hodos-world-draft-record";
const EXPORT_FORMAT = "hodos-world-draft-export";
const VERSION = "0.1.0";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let defaultStore;

function cloneData(value) {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function repositoryIdentity(repository) {
  if (typeof repository === "string") return repository;
  if (repository?.url) return repository.url;
  if (repository?.owner && repository?.repo) return `${repository.owner}/${repository.repo}`;
  throw new Error("World draft requires a repository identity");
}

function vector3(value, label, { positive = false } = {}) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => !Number.isFinite(entry))) {
    throw new Error(`${label} must contain three finite numbers`);
  }
  if (positive && value.some((entry) => entry <= 0)) throw new Error(`${label} values must be positive`);
  return [...value];
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function uniqueItems(values, label) {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array`);
  const ids = new Set();
  for (const [index, value] of values.entries()) {
    if (!value?.id) throw new Error(`${label} item ${index} requires an id`);
    if (ids.has(value.id)) throw new Error(`${label} contains duplicate id: ${value.id}`);
    ids.add(value.id);
  }
  return ids;
}

function validateScript(script, label) {
  object(script, label);
  if (script.language !== undefined && script.language !== "hara") throw new Error(`${label} language must be hara`);
  if (script.source !== undefined && typeof script.source !== "string") throw new Error(`${label} source must be text`);
  if (script.source && textEncoder.encode(script.source).byteLength > 64 * 1024) throw new Error(`${label} exceeds 64 KiB`);
  if (script.events !== undefined && (!Array.isArray(script.events) || script.events.some((event) => typeof event !== "string"))) {
    throw new Error(`${label} events must be an array of strings`);
  }
}

function validateEntity(entity, index, ids, collectionIds) {
  if (!entity || typeof entity !== "object" || !entity.id || !entity.kind) {
    throw new Error(`World draft entity ${index} is invalid`);
  }
  if (ids.has(entity.id)) throw new Error(`World draft contains duplicate entity id: ${entity.id}`);
  ids.add(entity.id);
  const transform = entity.transform ?? {};
  vector3(transform.position ?? [0, 0, 0], `World draft entity ${index} position`);
  vector3(transform.rotation ?? [0, 0, 0], `World draft entity ${index} rotation`);
  vector3(transform.scale ?? [1, 1, 1], `World draft entity ${index} scale`, { positive: true });
  vector3(entity.origin ?? [0, 0, 0], `World draft entity ${index} origin`);
  if (entity.parent && entity.parent === entity.id) throw new Error(`World draft entity ${index} cannot parent itself`);
  if (entity.collection && !collectionIds.has(entity.collection)) {
    throw new Error(`World draft entity ${index} references an unknown collection: ${entity.collection}`);
  }
  if (entity.components !== undefined) {
    object(entity.components, `World draft entity ${index} components`);
    if (entity.components.script) validateScript(entity.components.script, `World draft entity ${index} script`);
    if (entity.components.camera) {
      const camera = object(entity.components.camera, `World draft entity ${index} camera`);
      if (!Number.isFinite(camera.fov ?? 60) || (camera.fov ?? 60) < 1) throw new Error(`World draft entity ${index} camera fov is invalid`);
    }
    if (entity.components.trigger) {
      const trigger = object(entity.components.trigger, `World draft entity ${index} trigger`);
      vector3(trigger.size ?? [1, 1, 1], `World draft entity ${index} trigger size`, { positive: true });
    }
  }
}

function validateEntityHierarchy(entities, ids) {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  for (const [index, entity] of entities.entries()) {
    if (entity.parent && !ids.has(entity.parent)) {
      throw new Error(`World draft entity ${index} references an unknown parent: ${entity.parent}`);
    }
    const visited = new Set([entity.id]);
    let parent = entity.parent;
    while (parent) {
      if (visited.has(parent)) throw new Error(`World draft entity ${index} parent hierarchy contains a cycle`);
      visited.add(parent);
      parent = byId.get(parent)?.parent ?? null;
    }
  }
}

function validateCollections(collections) {
  const ids = uniqueItems(collections, "World draft collections");
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  for (const [index, collection] of collections.entries()) {
    if (collection.parent && !ids.has(collection.parent)) {
      throw new Error(`World draft collection ${index} references an unknown parent: ${collection.parent}`);
    }
    const visited = new Set([collection.id]);
    let parent = collection.parent;
    while (parent) {
      if (visited.has(parent)) throw new Error(`World draft collection ${index} hierarchy contains a cycle`);
      visited.add(parent);
      parent = byId.get(parent)?.parent ?? null;
    }
  }
  return ids;
}

function validateAssets(assets) {
  uniqueItems(assets, "World draft assets");
  for (const [index, asset] of assets.entries()) {
    if (asset.url !== null && asset.url !== undefined && typeof asset.url !== "string") {
      throw new Error(`World draft asset ${index} url must be text`);
    }
  }
}

function validatePrefabs(prefabs) {
  uniqueItems(prefabs, "World draft prefabs");
  for (const [index, prefab] of prefabs.entries()) {
    if (!Array.isArray(prefab.entities)) throw new Error(`World draft prefab ${index} entities must be an array`);
    const ids = uniqueItems(prefab.entities, `World draft prefab ${index} entities`);
    for (const entity of prefab.entities) {
      if (entity.parent && !ids.has(entity.parent)) throw new Error(`World draft prefab ${index} has an external parent`);
    }
  }
}

function validateAnimations(animations, entityIds) {
  uniqueItems(animations, "World draft animations");
  for (const [animationIndex, animation] of animations.entries()) {
    if (!Number.isFinite(animation.duration) || animation.duration <= 0) throw new Error(`World draft animation ${animationIndex} duration is invalid`);
    if (!Array.isArray(animation.tracks)) throw new Error(`World draft animation ${animationIndex} tracks must be an array`);
    uniqueItems(animation.tracks, `World draft animation ${animationIndex} tracks`);
    for (const [trackIndex, track] of animation.tracks.entries()) {
      if (!entityIds.has(track.entity)) throw new Error(`World draft animation ${animationIndex} track ${trackIndex} references an unknown entity`);
      if (!Array.isArray(track.keyframes)) throw new Error(`World draft animation ${animationIndex} track ${trackIndex} keyframes must be an array`);
      for (const [keyIndex, keyframe] of track.keyframes.entries()) {
        if (!Number.isFinite(keyframe.time) || keyframe.time < 0 || keyframe.time > animation.duration) {
          throw new Error(`World draft animation ${animationIndex} keyframe ${keyIndex} time is invalid`);
        }
      }
    }
  }
}

export function worldDraftKey(identity) {
  const repository = repositoryIdentity(identity?.repository);
  const commit = String(identity?.commit || "").trim();
  const project = String(identity?.project?.id || "").trim();
  if (!commit) throw new Error("World draft requires an immutable commit");
  if (!project) throw new Error("World draft requires a project id");
  return `${repository}@${commit}#${project}`;
}

export function validateWorldDraft(draft) {
  if (!draft || typeof draft !== "object") throw new Error("World draft must be an object");
  if (draft.format !== "hodos-world-draft" || draft.version !== VERSION) {
    throw new Error("World draft uses an unsupported format or version");
  }
  if (!Number.isInteger(draft.revision) || draft.revision < 0) {
    throw new Error("World draft revision must be a non-negative integer");
  }
  if (!Array.isArray(draft.audioSources)) throw new Error("World draft audioSources must be an array");
  const sourceIds = new Set();
  for (const [index, source] of draft.audioSources.entries()) {
    if (!source?.id || !source?.kind || !Array.isArray(source.position) || source.position.length !== 3) {
      throw new Error(`World draft source ${index} is invalid`);
    }
    if (sourceIds.has(source.id)) throw new Error(`World draft contains duplicate source id: ${source.id}`);
    sourceIds.add(source.id);
    if (source.position.some((value) => !Number.isFinite(value))) {
      throw new Error(`World draft source ${index} position must be finite`);
    }
  }

  const collections = draft.collections ?? [];
  const assets = draft.assets ?? [];
  const prefabs = draft.prefabs ?? [];
  const animations = draft.animations ?? [{ id: "main", duration: 10, fps: 30, tracks: [] }];
  if (!Array.isArray(collections) || !Array.isArray(assets) || !Array.isArray(prefabs) || !Array.isArray(animations)) {
    throw new Error("World draft authoring collections must be arrays");
  }
  const collectionIds = validateCollections(collections);
  validateAssets(assets);
  validatePrefabs(prefabs);

  const entities = draft.entities ?? [];
  if (!Array.isArray(entities)) throw new Error("World draft entities must be an array");
  const ids = new Set();
  entities.forEach((entity, index) => validateEntity(entity, index, ids, collectionIds));
  validateEntityHierarchy(entities, ids);
  validateAnimations(animations, ids);
  return cloneData({ ...draft, entities, collections, assets, prefabs, animations });
}

export class WorldDraftStore {
  constructor(backend = createStudioStore().backend) {
    if (!backend) throw new Error("WorldDraftStore requires a storage backend");
    this.backend = backend;
    this.kind = backend.kind;
    this.persistent = backend.persistent;
    this.pending = Promise.resolve();
  }

  async prepare() {
    return this.backend.prepare();
  }

  path(identity) {
    return `world-drafts/${encodeURIComponent(worldDraftKey(identity))}.json`;
  }

  save(identity, draft) {
    const key = worldDraftKey(identity);
    const record = {
      format: RECORD_FORMAT,
      version: VERSION,
      world: key,
      savedAt: new Date().toISOString(),
      identity: cloneData(identity),
      draft: validateWorldDraft(draft),
    };
    const write = this.pending.then(async () => {
      await this.backend.write(this.path(identity), textEncoder.encode(JSON.stringify(record)));
      return record;
    });
    this.pending = write.catch(() => {});
    return write;
  }

  async load(identity) {
    await this.pending;
    const key = worldDraftKey(identity);
    try {
      const bytes = await this.backend.read(this.path(identity));
      const record = JSON.parse(textDecoder.decode(bytes));
      if (record?.format !== RECORD_FORMAT || record?.version !== VERSION) {
        throw new Error("Stored world draft uses an unsupported record format");
      }
      if (record.world !== key) throw new Error("Stored world draft identity does not match its key");
      return validateWorldDraft(record.draft);
    } catch (error) {
      if (error?.name === "NotFoundError") return null;
      throw error;
    }
  }
}

export function createWorldDraftStore({ backend } = {}) {
  if (backend) return new WorldDraftStore(backend);
  if (!defaultStore) defaultStore = new WorldDraftStore();
  return defaultStore;
}

export function worldDraftExport(identity, draft, { exportedAt = new Date().toISOString() } = {}) {
  return {
    format: EXPORT_FORMAT,
    version: VERSION,
    exportedAt,
    identity: cloneData(identity),
    draft: validateWorldDraft(draft),
  };
}

export async function saveWorldDraftFile(identity, draft) {
  const envelope = worldDraftExport(identity, draft);
  const project = safeFilename(identity?.project?.id || "hodos-world");
  const commit = safeFilename(String(identity?.commit || "draft").slice(0, 12));
  const name = `${project}-${commit}.hodos-world.json`;
  const bytes = textEncoder.encode(`${JSON.stringify(envelope, null, 2)}\n`);
  return saveBlob(new Blob([bytes], { type: "application/json" }), name);
}
