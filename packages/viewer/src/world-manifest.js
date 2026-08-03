import { parseEDNString } from "edn-data";

export const WORLD_LIMITS = Object.freeze({
  manifestBytes: 1024 * 1024,
  importDepth: 8,
  projects: 24,
  layers: 64,
  touchpoints: 128,
});

const REQUIRED_PROJECT_KEYS = [
  "hara/type", "hara/version", "project/id", "project/version",
  "project/source-paths", "project/test-paths", "project/extension-paths",
  "project/capabilities", "project/world",
];

const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const hexColor = /^#[0-9a-f]{6}$/i;
const TOUCHPOINT_PRESENTATIONS = new Set(["focus-overlay", "overlay", "panel", "modal"]);
const TOUCHPOINT_ANCHORS = new Set(["world", "scene-center"]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Set) {
    throw new Error(`${label} must be an EDN map`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be a vector`);
  return value;
}

function scalar(value, label) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.sym === "string") return value.sym;
  throw new Error(`${label} must be a string, symbol, or keyword`);
}

function string(value, label) {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function identifier(value, label) {
  const output = scalar(value, label);
  if (!output || !/^[A-Za-z0-9_.\/-]+$/.test(output)) throw new Error(`${label} is invalid`);
  return output;
}

function number(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

function vector3(value, label, fallback) {
  if (value === undefined) return [...fallback];
  const values = array(value, label);
  if (values.length !== 3) throw new Error(`${label} must contain three numbers`);
  return values.map((item, index) => number(item, `${label}[${index}]`));
}

function relativeAsset(value, label) {
  const path = string(value, label).trim();
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes("?") || path.includes("#")) {
    throw new Error(`${label} must be a repository-relative path`);
  }
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label} cannot contain empty, current, or parent segments`);
  }
  if (!(path.endsWith(".sog") || path.endsWith("lod-meta.json"))) {
    throw new Error(`${label} must end in .sog or lod-meta.json`);
  }
  return path;
}

export function normalizeTransform(value = {}, label = "world transform") {
  const input = object(value, label);
  const scale = input["world/scale"] === undefined ? 1 : number(input["world/scale"], `${label} :world/scale`);
  if (scale <= 0) throw new Error(`${label} :world/scale must be greater than zero`);
  return {
    position: vector3(input["world/position"], `${label} :world/position`, [0, 0, 0]),
    rotation: vector3(input["world/rotation"], `${label} :world/rotation`, [0, 0, 0]),
    scale,
  };
}

function normalizeCamera(value, label = ":world/camera") {
  if (value === undefined) return null;
  const input = object(value, label);
  const fov = input["world/fov"] === undefined ? 60 : number(input["world/fov"], `${label} :world/fov`);
  if (fov < 10 || fov > 120) throw new Error(`${label} :world/fov must be between 10 and 120`);
  return {
    position: vector3(input["world/position"], `${label} :world/position`, [0, 1.5, 4]),
    target: vector3(input["world/target"], `${label} :world/target`, [0, 1, 0]),
    fov,
  };
}

function normalizeLayer(value, index) {
  const layer = object(value, `:world/layers[${index}]`);
  return {
    id: identifier(layer["world/id"], `:world/layers[${index}] :world/id`),
    asset: relativeAsset(layer["world/asset"], `:world/layers[${index}] :world/asset`),
    transform: normalizeTransform(layer["world/transform"] ?? {}, `:world/layers[${index}] :world/transform`),
  };
}

function normalizeImport(value, index) {
  const entry = object(value, `:world/imports[${index}]`);
  return {
    id: identifier(entry["world/id"], `:world/imports[${index}] :world/id`),
    repository: string(entry["world/repository"], `:world/imports[${index}] :world/repository`),
    ref: string(entry["world/ref"], `:world/imports[${index}] :world/ref`).trim(),
    transform: normalizeTransform(entry["world/transform"] ?? {}, `:world/imports[${index}] :world/transform`),
  };
}

function normalizeTouchpoint(value, index) {
  const label = `:world/touchpoints[${index}]`;
  const entry = object(value, label);
  const id = identifier(entry["touchpoint/id"], `${label} :touchpoint/id`);
  const presentation = entry["touchpoint/presentation"] === undefined
    ? "focus-overlay"
    : scalar(entry["touchpoint/presentation"], `${label} :touchpoint/presentation`);
  if (!TOUCHPOINT_PRESENTATIONS.has(presentation)) {
    throw new Error(`${label} :touchpoint/presentation must be focus-overlay, overlay, panel, or modal`);
  }
  const anchor = entry["touchpoint/anchor"] === undefined
    ? "world"
    : scalar(entry["touchpoint/anchor"], `${label} :touchpoint/anchor`);
  if (!TOUCHPOINT_ANCHORS.has(anchor)) {
    throw new Error(`${label} :touchpoint/anchor must be world or scene-center`);
  }
  const radius = entry["touchpoint/radius"] === undefined
    ? 0.5
    : number(entry["touchpoint/radius"], `${label} :touchpoint/radius`);
  if (radius <= 0) throw new Error(`${label} :touchpoint/radius must be greater than zero`);
  return {
    id,
    label: entry["touchpoint/label"] === undefined
      ? id
      : string(entry["touchpoint/label"], `${label} :touchpoint/label`),
    surface: identifier(entry["touchpoint/surface"], `${label} :touchpoint/surface`),
    presentation,
    anchor,
    position: vector3(entry["touchpoint/position"], `${label} :touchpoint/position`, [0, 0, 0]),
    radius,
    camera: normalizeCamera(entry["touchpoint/camera"], `${label} :touchpoint/camera`),
    config: entry["touchpoint/config"] === undefined
      ? {}
      : object(entry["touchpoint/config"], `${label} :touchpoint/config`),
  };
}

export function parseProjectEdn(source) {
  if (new TextEncoder().encode(String(source)).byteLength > WORLD_LIMITS.manifestBytes) {
    throw new Error(`project.edn exceeds ${WORLD_LIMITS.manifestBytes} bytes`);
  }
  try {
    return parseEDNString(String(source), {
      mapAs: "object", setAs: "array", listAs: "array",
      keywordAs: "string", charAs: "string", objectKeysAs: "string",
    });
  } catch (error) {
    throw new Error(`project.edn is not valid EDN: ${error.message}`);
  }
}

export function validateWorldProject(value) {
  const project = object(value, "project.edn");
  for (const key of REQUIRED_PROJECT_KEYS) {
    if (!(key in project)) throw new Error(`project.edn missing required key :${key}`);
  }
  if (project["hara/type"] !== "project") throw new Error("project.edn :hara/type must be :project");
  if (project["hara/version"] !== "1.0.0") throw new Error("project.edn requires :hara/version \"1.0.0\"");
  const version = string(project["project/version"], ":project/version");
  if (!semver.test(version)) throw new Error(":project/version must be SemVer");

  const sourcePaths = array(project["project/source-paths"], ":project/source-paths");
  const testPaths = array(project["project/test-paths"], ":project/test-paths");
  const extensionPaths = array(project["project/extension-paths"], ":project/extension-paths");
  for (const [key, paths] of [
    ["project/source-paths", sourcePaths],
    ["project/test-paths", testPaths],
    ["project/extension-paths", extensionPaths],
  ]) {
    paths.forEach((path) => string(path, `:${key} entry`));
  }

  const capabilities = array(project["project/capabilities"], ":project/capabilities");
  for (const required of ["canvas/webgl2", "input/pointer"]) {
    if (!capabilities.includes(required)) throw new Error(`project.edn requires capability :${required}`);
  }

  const world = object(project["project/world"], ":project/world");
  if (world["world/version"] !== "1.0.0") throw new Error(":project/world requires :world/version \"1.0.0\"");
  const layers = array(world["world/layers"] ?? [], ":world/layers").map(normalizeLayer);
  const imports = array(world["world/imports"] ?? [], ":world/imports").map(normalizeImport);
  const touchpoints = array(world["world/touchpoints"] ?? [], ":world/touchpoints").map(normalizeTouchpoint);
  if (!layers.length && !imports.length) throw new Error(":project/world must declare at least one layer or import");
  if (touchpoints.length > WORLD_LIMITS.touchpoints) {
    throw new Error(`:world/touchpoints exceeds ${WORLD_LIMITS.touchpoints} entries`);
  }
  if (touchpoints.length && !capabilities.includes("ui/dom-surface")) {
    throw new Error("project.edn touchpoints require capability :ui/dom-surface");
  }

  const ids = [...layers, ...imports].map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new Error(":world/id values must be unique within a project");
  const touchpointIds = touchpoints.map(({ id }) => id);
  if (new Set(touchpointIds).size !== touchpointIds.length) {
    throw new Error(":touchpoint/id values must be unique within a project");
  }

  const background = world["world/background"] ?? "#08110e";
  if (typeof background !== "string" || !hexColor.test(background)) throw new Error(":world/background must be a six-digit hex colour");

  return {
    id: identifier(project["project/id"], ":project/id"),
    version,
    title: world["world/title"] === undefined
      ? identifier(project["project/id"], ":project/id")
      : string(world["world/title"], ":world/title"),
    layers,
    imports,
    touchpoints,
    camera: normalizeCamera(world["world/camera"]),
    background,
    capabilities: [...capabilities],
    sourcePaths: [...sourcePaths],
    testPaths: [...testPaths],
    extensionPaths: [...extensionPaths],
    dependencies: project["project/dependencies"] ?? {},
  };
}

export function readWorldProject(source) {
  return validateWorldProject(parseProjectEdn(source));
}
