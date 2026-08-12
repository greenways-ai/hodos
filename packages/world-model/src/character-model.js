import {
  clonePortable,
  finiteNumber,
  isPlainObject,
  issue,
  optionalString,
  requiredString,
  safeInteger,
  uniqueStrings,
  validationResult,
} from "./model-values.js";

export const CHARACTER_SCHEMA = "hodos.character/0-alpha";
export const CHARACTER_LAYER_MODES = Object.freeze(["override", "additive"]);
export const CHARACTER_ROOT_MOTION_MODES = Object.freeze(["none", "extract", "apply"]);

function normalizeMarker(value, index, path) {
  const input = isPlainObject(value) ? value : { id: value };
  return {
    id: requiredString(input.id ?? input.name, `${path}[${index}].id`),
    at: Math.max(0, finiteNumber(input.at, 0, `${path}[${index}].at`)),
    value: input.value === undefined ? null : clonePortable(input.value),
  };
}

function normalizeClip(value, id, path) {
  const input = typeof value === "string" ? { resourceId: value } : clonePortable(value);
  if (!isPlainObject(input)) throw new TypeError(`${path} must be an object or resource id`);
  const markers = (input.markers ?? []).map((entry, index) => normalizeMarker(entry, index, `${path}.markers`));
  const markerIds = new Set();
  for (const marker of markers) {
    if (markerIds.has(marker.id)) throw new Error(`${path} repeats marker ${marker.id}`);
    markerIds.add(marker.id);
  }
  markers.sort((left, right) => left.at - right.at || left.id.localeCompare(right.id));
  const rootMotion = requiredString(input.rootMotion ?? "none", `${path}.rootMotion`);
  if (!CHARACTER_ROOT_MOTION_MODES.includes(rootMotion)) {
    throw new Error(`${path}.rootMotion has unsupported mode: ${rootMotion}`);
  }
  const duration = finiteNumber(input.duration, null, `${path}.duration`);
  if (duration !== null && duration < 0) throw new TypeError(`${path}.duration must be non-negative`);
  return {
    id,
    resourceId: requiredString(input.resourceId ?? input.resource, `${path}.resourceId`),
    duration,
    loop: input.loop === true,
    rootMotion,
    layer: optionalString(input.layer, `${path}.layer`),
    markers,
    metadata: clonePortable(input.metadata ?? {}),
  };
}

function normalizeLayer(value, index) {
  const input = clonePortable(value);
  if (!isPlainObject(input)) throw new TypeError(`character.layers[${index}] must be an object`);
  const mode = requiredString(input.mode ?? "override", `character.layers[${index}].mode`);
  if (!CHARACTER_LAYER_MODES.includes(mode)) {
    throw new Error(`character.layers[${index}].mode has unsupported value: ${mode}`);
  }
  const weight = finiteNumber(input.weight, 1, `character.layers[${index}].weight`);
  if (weight < 0 || weight > 1) throw new TypeError(`character.layers[${index}].weight must be between zero and one`);
  return {
    id: requiredString(input.id, `character.layers[${index}].id`),
    mode,
    mask: optionalString(input.mask, `character.layers[${index}].mask`),
    weight,
    metadata: clonePortable(input.metadata ?? {}),
  };
}

export function normalizeCharacterProfile(value, label = "Hodos character") {
  const input = clonePortable(value);
  if (!isPlainObject(input)) throw new TypeError(`${label} must be an object`);
  const schema = requiredString(input.schema ?? CHARACTER_SCHEMA, `${label}.schema`);
  if (schema !== CHARACTER_SCHEMA) throw new Error(`${label} has unsupported schema: ${schema}`);
  const clipInput = input.clips ?? {};
  if (!isPlainObject(clipInput)) throw new TypeError(`${label}.clips must be an object`);
  const clips = {};
  for (const id of Object.keys(clipInput).sort()) {
    const clipId = requiredString(id, `${label}.clips id`);
    clips[clipId] = normalizeClip(clipInput[id], clipId, `${label}.clips.${clipId}`);
  }
  const layers = (input.layers?.length ? input.layers : [{ id: "base" }]).map(normalizeLayer);
  const layerIds = new Set();
  for (const layer of layers) {
    if (layerIds.has(layer.id)) throw new Error(`${label} repeats layer ${layer.id}`);
    layerIds.add(layer.id);
  }
  for (const clip of Object.values(clips)) {
    if (clip.layer && !layerIds.has(clip.layer)) {
      throw new Error(`${label} clip ${clip.id} references missing layer ${clip.layer}`);
    }
  }
  return {
    schema,
    id: requiredString(input.id ?? input.characterId, `${label}.id`),
    revision: safeInteger(input.revision, 0, `${label}.revision`),
    assetId: requiredString(input.assetId, `${label}.assetId`),
    rigId: optionalString(input.rigId, `${label}.rigId`),
    clips,
    layers,
    capabilities: uniqueStrings(input.capabilities ?? [], `${label}.capabilities`).sort(),
    metadata: clonePortable(input.metadata ?? {}),
  };
}

export function createCharacterProfile(options) {
  return normalizeCharacterProfile(options);
}

export function validateCharacterProfile(value) {
  try {
    normalizeCharacterProfile(value);
    return validationResult();
  } catch (error) {
    return validationResult([
      issue("character/invalid", "$", error instanceof Error ? error.message : String(error)),
    ]);
  }
}
