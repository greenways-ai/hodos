import {
  clonePortable,
  finiteNumber,
  isPlainObject,
  optionalString,
  requiredString,
  safeInteger,
  vector,
} from "./rigging-values.js";

export const RIG_SOURCE_SCHEMA = "hodos.rig-source/0-alpha";
export const RIG_PREFLIGHT_SCHEMA = "hodos.rig-preflight/0-alpha";
export const RIG_SESSION_SCHEMA = "hodos.rig-session/0-alpha";
export const RIG_SOURCE_HANDLE_TYPE = "rig/source-asset";
export const MAX_RIG_PREFLIGHT_ISSUES = 64;
export const MAX_RIG_PREFLIGHT_ITEMS = 64;
export const MAX_RIG_PREFLIGHT_ITEM_BYTES = 8192;

const SHA256_ID = /^sha256:[0-9a-f]{64}$/;
const ISSUE_SEVERITIES = new Set(["error", "warning", "info"]);
const ATTEMPT_STATUSES = new Set(["succeeded", "failed"]);

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

function portable(value, path, maximumBytes = MAX_RIG_PREFLIGHT_ITEM_BYTES) {
  const cloned = clonePortable(value);
  const encoded = JSON.stringify(cloned);
  const byteLength = new TextEncoder().encode(encoded).byteLength;
  if (byteLength > maximumBytes) {
    throw new TypeError(`${path} exceeds the bounded portable size of ${maximumBytes} bytes`);
  }
  return cloned;
}

function boundedString(value, fallback, path, maximumLength = 512) {
  const candidate = value === undefined || value === null || value === "" ? fallback : value;
  const text = requiredString(candidate, path);
  if (text.length > maximumLength) throw new TypeError(`${path} exceeds ${maximumLength} characters`);
  return text;
}

function optionalBoundedString(value, path, maximumLength = 512) {
  const text = optionalString(value, path);
  if (text !== null && text.length > maximumLength) throw new TypeError(`${path} exceeds ${maximumLength} characters`);
  return text;
}

function normalizeHandle(value, path = "source.handle") {
  if (!isPlainObject(value)) throw new TypeError(`${path} must be an object`);
  const type = boundedString(value.type, RIG_SOURCE_HANDLE_TYPE, `${path}.type`, 128);
  const id = boundedString(value.id, undefined, `${path}.id`, 256);
  const scope = boundedString(value.scope, "session", `${path}.scope`, 64);
  if (scope !== "session") throw new TypeError(`${path}.scope must be session`);
  return { type, id, scope };
}

export function normalizeRiggingSource(value = {}) {
  if (!isPlainObject(value)) throw new TypeError("Rigging source must be an object");
  const schema = value.schema ?? RIG_SOURCE_SCHEMA;
  if (schema !== RIG_SOURCE_SCHEMA) throw new TypeError(`Rigging source schema must be ${RIG_SOURCE_SCHEMA}`);
  const contentId = requiredString(value.contentId, "source.contentId");
  if (!SHA256_ID.test(contentId)) throw new TypeError("source.contentId must be a lowercase sha256 content identity");
  const revision = safeInteger(value.revision, 0, "source.revision", 0);
  const byteLength = safeInteger(value.byteLength, undefined, "source.byteLength", 12);
  const handle = normalizeHandle(value.handle);
  clonePortable(value);
  const result = {
    schema,
    contentId,
    revision,
    fileName: boundedString(value.fileName, "asset.glb", "source.fileName"),
    mediaType: boundedString(value.mediaType, "model/gltf-binary", "source.mediaType", 128),
    byteLength,
    handle,
  };
  return deepFreeze(result);
}

export function createRiggingSource(value) {
  return normalizeRiggingSource({ ...value, schema: RIG_SOURCE_SCHEMA });
}

function normalizeIssue(value, index) {
  const path = `preflight.issues[${index}]`;
  if (!isPlainObject(value)) throw new TypeError(`${path} must be an object`);
  const severity = boundedString(value.severity, "warning", `${path}.severity`, 16);
  if (!ISSUE_SEVERITIES.has(severity)) throw new TypeError(`${path}.severity is unsupported`);
  const issue = {
    code: boundedString(value.code, undefined, `${path}.code`, 128),
    severity,
    path: boundedString(value.path, "$", `${path}.path`, 512),
    message: boundedString(value.message, undefined, `${path}.message`, 1024),
  };
  if (value.details !== undefined && value.details !== null) {
    issue.details = portable(value.details, `${path}.details`, 4096);
  }
  return issue;
}

function normalizeInventoryItems(value, path) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  if (value.length > MAX_RIG_PREFLIGHT_ITEMS) {
    throw new TypeError(`${path} exceeds the bounded item limit of ${MAX_RIG_PREFLIGHT_ITEMS}`);
  }
  return value.map((entry, index) => portable(entry, `${path}[${index}]`));
}

function normalizeInventorySection(value, path, extra = {}) {
  if (!isPlainObject(value)) throw new TypeError(`${path} must be an object`);
  const section = {
    count: safeInteger(value.count, 0, `${path}.count`, 0),
    items: normalizeInventoryItems(value.items, `${path}.items`),
    omitted: safeInteger(value.omitted, 0, `${path}.omitted`, 0),
  };
  if (section.items.length + section.omitted > section.count) {
    throw new TypeError(`${path} item and omitted counts cannot exceed the total count`);
  }
  for (const [key, minimum] of Object.entries(extra)) {
    section[key] = safeInteger(value[key], 0, `${path}.${key}`, minimum);
  }
  return section;
}

function normalizeBounds(value) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) throw new TypeError("preflight.geometry.bounds must be an object or null");
  const min = vector(value.min, undefined, 3, "preflight.geometry.bounds.min");
  const max = vector(value.max, undefined, 3, "preflight.geometry.bounds.max");
  if (min.some((entry, index) => entry > max[index])) {
    throw new TypeError("preflight.geometry.bounds minimum cannot exceed maximum");
  }
  const center = vector(value.center, min.map((entry, index) => (entry + max[index]) / 2), 3, "preflight.geometry.bounds.center");
  const size = vector(value.size, min.map((entry, index) => max[index] - entry), 3, "preflight.geometry.bounds.size");
  if (size.some((entry) => entry < 0)) throw new TypeError("preflight.geometry.bounds size cannot be negative");
  return { min, max, center, size };
}

function normalizePrimitiveModes(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 16) {
    throw new TypeError("preflight.geometry.primitiveModes must be an array with at most 16 entries");
  }
  return value.map((entry, index) => {
    if (!isPlainObject(entry)) throw new TypeError(`preflight.geometry.primitiveModes[${index}] must be an object`);
    return {
      mode: safeInteger(entry.mode, undefined, `preflight.geometry.primitiveModes[${index}].mode`, 0),
      label: boundedString(entry.label, "UNKNOWN", `preflight.geometry.primitiveModes[${index}].label`, 64),
      count: safeInteger(entry.count, 0, `preflight.geometry.primitiveModes[${index}].count`, 0),
    };
  });
}

function normalizeProvider(value) {
  if (!isPlainObject(value)) throw new TypeError("preflight.provider must be an object");
  return {
    id: boundedString(value.id, undefined, "preflight.provider.id", 128),
    version: boundedString(value.version, undefined, "preflight.provider.version", 128),
    profile: boundedString(value.profile, "default", "preflight.provider.profile", 128),
  };
}

function normalizeFormat(value, sourceId) {
  if (!isPlainObject(value)) throw new TypeError("preflight.format must be an object");
  return {
    container: boundedString(value.container, "glb", "preflight.format.container", 32),
    version: safeInteger(value.version, undefined, "preflight.format.version", 0),
    byteLength: safeInteger(value.byteLength, undefined, "preflight.format.byteLength", 12),
    jsonChunkBytes: safeInteger(value.jsonChunkBytes, 0, "preflight.format.jsonChunkBytes", 0),
    binaryChunkBytes: safeInteger(value.binaryChunkBytes, 0, "preflight.format.binaryChunkBytes", 0),
    generator: optionalBoundedString(value.generator, "preflight.format.generator", 256),
    sourceId,
  };
}

export function normalizeRiggingPreflight(value = {}) {
  clonePortable(value);
  if (!isPlainObject(value)) throw new TypeError("Rigging preflight must be an object");
  const schema = value.schema ?? RIG_PREFLIGHT_SCHEMA;
  if (schema !== RIG_PREFLIGHT_SCHEMA) throw new TypeError(`Rigging preflight schema must be ${RIG_PREFLIGHT_SCHEMA}`);
  const sourceId = requiredString(value.sourceId, "preflight.sourceId");
  if (!SHA256_ID.test(sourceId)) throw new TypeError("preflight.sourceId must be a lowercase sha256 content identity");
  const sourceRevision = safeInteger(value.sourceRevision, 0, "preflight.sourceRevision", 0);
  const inventory = value.inventory ?? {};
  const geometry = value.geometry ?? {};
  const transforms = value.transforms ?? {};
  const features = value.features ?? {};
  if (!isPlainObject(inventory) || !isPlainObject(geometry) || !isPlainObject(transforms) || !isPlainObject(features)) {
    throw new TypeError("preflight inventory, geometry, transforms, and features must be objects");
  }
  const issuesValue = value.issues ?? [];
  if (!Array.isArray(issuesValue) || issuesValue.length > MAX_RIG_PREFLIGHT_ISSUES) {
    throw new TypeError(`preflight.issues exceeds the bounded limit of ${MAX_RIG_PREFLIGHT_ISSUES}`);
  }
  const issues = issuesValue.map(normalizeIssue);
  const visible = {
    errors: issues.filter((entry) => entry.severity === "error").length,
    warnings: issues.filter((entry) => entry.severity === "warning").length,
    info: issues.filter((entry) => entry.severity === "info").length,
  };
  const summaryValue = value.summary ?? {};
  if (!isPlainObject(summaryValue)) throw new TypeError("preflight.summary must be an object");
  const errors = safeInteger(summaryValue.errors, visible.errors, "preflight.summary.errors", visible.errors);
  const warnings = safeInteger(summaryValue.warnings, visible.warnings, "preflight.summary.warnings", visible.warnings);
  const info = safeInteger(summaryValue.info, visible.info, "preflight.summary.info", visible.info);
  const omittedIssues = safeInteger(summaryValue.omittedIssues, 0, "preflight.summary.omittedIssues", 0);
  const status = errors > 0 ? "blocked" : warnings > 0 ? "warn" : "ready";

  const result = {
    schema,
    sourceId,
    sourceRevision,
    provider: normalizeProvider(value.provider),
    format: normalizeFormat(value.format, sourceId),
    inventory: {
      scenes: normalizeInventorySection(inventory.scenes ?? {}, "preflight.inventory.scenes"),
      nodes: normalizeInventorySection(inventory.nodes ?? {}, "preflight.inventory.nodes", { roots: 0 }),
      meshes: normalizeInventorySection(inventory.meshes ?? {}, "preflight.inventory.meshes", { instances: 0, primitives: 0 }),
      materials: normalizeInventorySection(inventory.materials ?? {}, "preflight.inventory.materials", { referenced: 0 }),
      skins: normalizeInventorySection(inventory.skins ?? {}, "preflight.inventory.skins", { joints: 0 }),
      animations: normalizeInventorySection(inventory.animations ?? {}, "preflight.inventory.animations", { channels: 0, samplers: 0 }),
    },
    geometry: {
      vertices: safeInteger(geometry.vertices, 0, "preflight.geometry.vertices", 0),
      indices: safeInteger(geometry.indices, 0, "preflight.geometry.indices", 0),
      triangles: safeInteger(geometry.triangles, 0, "preflight.geometry.triangles", 0),
      lines: safeInteger(geometry.lines, 0, "preflight.geometry.lines", 0),
      points: safeInteger(geometry.points, 0, "preflight.geometry.points", 0),
      connectedComponents: safeInteger(geometry.connectedComponents, 0, "preflight.geometry.connectedComponents", 0),
      disconnectedPrimitives: safeInteger(geometry.disconnectedPrimitives, 0, "preflight.geometry.disconnectedPrimitives", 0),
      topologyPrimitivesChecked: safeInteger(geometry.topologyPrimitivesChecked, 0, "preflight.geometry.topologyPrimitivesChecked", 0),
      topologyPrimitivesSkipped: safeInteger(geometry.topologyPrimitivesSkipped, 0, "preflight.geometry.topologyPrimitivesSkipped", 0),
      nonManifoldEdgeHints: safeInteger(geometry.nonManifoldEdgeHints, 0, "preflight.geometry.nonManifoldEdgeHints", 0),
      missingNormalPrimitives: safeInteger(geometry.missingNormalPrimitives, 0, "preflight.geometry.missingNormalPrimitives", 0),
      malformedSkinPrimitives: safeInteger(geometry.malformedSkinPrimitives, 0, "preflight.geometry.malformedSkinPrimitives", 0),
      bounds: normalizeBounds(geometry.bounds),
      primitiveModes: normalizePrimitiveModes(geometry.primitiveModes),
    },
    transforms: {
      matrixNodes: safeInteger(transforms.matrixNodes, 0, "preflight.transforms.matrixNodes", 0),
      trsNodes: safeInteger(transforms.trsNodes, 0, "preflight.transforms.trsNodes", 0),
      nonIdentityNodes: safeInteger(transforms.nonIdentityNodes, 0, "preflight.transforms.nonIdentityNodes", 0),
      negativeScaleNodes: safeInteger(transforms.negativeScaleNodes, 0, "preflight.transforms.negativeScaleNodes", 0),
      extremeScaleNodes: safeInteger(transforms.extremeScaleNodes, 0, "preflight.transforms.extremeScaleNodes", 0),
    },
    features: {
      hasNormals: Boolean(features.hasNormals),
      hasTangents: Boolean(features.hasTangents),
      hasColors: Boolean(features.hasColors),
      hasTexcoords: Boolean(features.hasTexcoords),
      hasMorphTargets: Boolean(features.hasMorphTargets),
      hasSkins: Boolean(features.hasSkins),
      hasAnimations: Boolean(features.hasAnimations),
      hasExternalResources: Boolean(features.hasExternalResources),
    },
    issues,
    summary: { status, errors, warnings, info, omittedIssues },
  };
  return deepFreeze(result);
}

export function createRiggingPreflight(value) {
  return normalizeRiggingPreflight({ ...value, schema: RIG_PREFLIGHT_SCHEMA });
}

function normalizeOpenError(value, path = "session.lastAttempt.error") {
  if (!isPlainObject(value)) throw new TypeError(`${path} must be an object`);
  const result = {
    code: boundedString(value.code, "rig/open-failed", `${path}.code`, 128),
    message: boundedString(value.message, "Unable to open the local GLB", `${path}.message`, 1024),
  };
  if (value.details !== undefined && value.details !== null) result.details = portable(value.details, `${path}.details`, 4096);
  return result;
}

function normalizeAttempt(value) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) throw new TypeError("session.lastAttempt must be an object or null");
  const status = boundedString(value.status, undefined, "session.lastAttempt.status", 32);
  if (!ATTEMPT_STATUSES.has(status)) throw new TypeError("session.lastAttempt.status is unsupported");
  const attempt = {
    sequence: safeInteger(value.sequence, undefined, "session.lastAttempt.sequence", 1),
    status,
    fileName: boundedString(value.fileName, "asset.glb", "session.lastAttempt.fileName"),
    byteLength: safeInteger(value.byteLength, 0, "session.lastAttempt.byteLength", 0),
    sourceId: optionalBoundedString(value.sourceId, "session.lastAttempt.sourceId", 80),
    recoverable: Boolean(value.recoverable),
    error: status === "failed" ? normalizeOpenError(value.error ?? {}) : null,
  };
  if (attempt.sourceId !== null && !SHA256_ID.test(attempt.sourceId)) {
    throw new TypeError("session.lastAttempt.sourceId must be a lowercase sha256 content identity");
  }
  return attempt;
}

function normalizeActive(value) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) throw new TypeError("session.active must be an object or null");
  const source = normalizeRiggingSource(value.source);
  const preflight = normalizeRiggingPreflight(value.preflight);
  if (source.contentId !== preflight.sourceId || source.revision !== preflight.sourceRevision) {
    throw new TypeError("session.active source and preflight identities do not match");
  }
  return { source, preflight };
}

export function normalizeRiggingSession(value = {}) {
  if (!isPlainObject(value)) throw new TypeError("Rigging session must be an object");
  const schema = value.schema ?? RIG_SESSION_SCHEMA;
  if (schema !== RIG_SESSION_SCHEMA) throw new TypeError(`Rigging session schema must be ${RIG_SESSION_SCHEMA}`);
  const id = boundedString(value.id, undefined, "session.id", 256);
  clonePortable(value);
  const revision = safeInteger(value.revision, 0, "session.revision", 0);
  const active = normalizeActive(value.active);
  const lastAttempt = normalizeAttempt(value.lastAttempt);
  if (lastAttempt && lastAttempt.sequence > revision) {
    throw new TypeError("session.lastAttempt.sequence cannot exceed the session revision");
  }
  const status = active ? "ready" : lastAttempt?.status === "failed" ? "failed" : "empty";
  return deepFreeze({
    schema,
    id,
    revision,
    status,
    active,
    lastAttempt,
  });
}

export function createRiggingSession({ id } = {}) {
  return normalizeRiggingSession({ schema: RIG_SESSION_SCHEMA, id, revision: 0, active: null, lastAttempt: null });
}

export function acceptRiggingSource(sessionValue, { source, preflight }) {
  const session = normalizeRiggingSession(sessionValue);
  const active = normalizeActive({ source, preflight });
  const revision = session.revision + 1;
  return normalizeRiggingSession({
    ...session,
    revision,
    active,
    lastAttempt: {
      sequence: revision,
      status: "succeeded",
      fileName: active.source.fileName,
      byteLength: active.source.byteLength,
      sourceId: active.source.contentId,
      recoverable: true,
      error: null,
    },
  });
}

export function recordRiggingOpenFailure(sessionValue, {
  fileName = "asset.glb",
  byteLength = 0,
  sourceId = null,
  error = {},
} = {}) {
  const session = normalizeRiggingSession(sessionValue);
  const revision = session.revision + 1;
  return normalizeRiggingSession({
    ...session,
    revision,
    lastAttempt: {
      sequence: revision,
      status: "failed",
      fileName,
      byteLength,
      sourceId,
      recoverable: Boolean(session.active),
      error,
    },
  });
}

export function activeRiggingSource(sessionValue) {
  return normalizeRiggingSession(sessionValue).active;
}
